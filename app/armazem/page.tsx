'use client'

import { useState, useEffect } from 'react'
import { createClient } from '../lib/supabase'
import { useRouter } from 'next/navigation'

type Pacote = {
    id: string
    barcode: string
    status: string
    created_at: string
    clients: { name: string } | null
    diasParado: number
}

type Incidente = {
    id: string
    barcode: string
    type: string
    description: string | null
    status: string
    operator_name: string | null
    created_at: string
}

const tipoIncidente: Record<string, string> = {
    avaria: '💥 Avaria',
    extravio: '❓ Extravio',
    roubo: '🚨 Roubo',
    lost: '💀 Lost',
    endereco_errado: '📍 Endereço Errado',
    cliente_recusou: '🚫 Cliente Recusou',
    outros: '📝 Outros'
}

const statusIncidente: Record<string, { label: string, color: string, bg: string }> = {
    aberto: { label: 'Aberto', color: '#ff5252', bg: '#2b0d0d' },
    em_analise: { label: 'Em Análise', color: '#ffb300', bg: '#2b1f0d' },
    resolvido: { label: 'Resolvido', color: '#00e676', bg: '#0d2b1a' }
}

export default function ArmazemPage() {
    const router = useRouter()
    const supabase = createClient()

    const [companyId, setCompanyId] = useState('')
    const [operatorId, setOperatorId] = useState('')
    const [operatorName, setOperatorName] = useState('')
    const [aba, setAba] = useState<'estoque' | 'parados' | 'incidentes' | 'extravio'>('estoque')

    const [estoque, setEstoque] = useState<Pacote[]>([])
    const [parados, setParados] = useState<Pacote[]>([])
    const [paradosMotorista, setParadosMotorista] = useState<Pacote[]>([])
    const [incidentes, setIncidentes] = useState<Incidente[]>([])
    const [extravios, setExtravios] = useState<Pacote[]>([])
    const [loading, setLoading] = useState(true)

    // Modal incidente
    const [modalIncidente, setModalIncidente] = useState(false)
    const [pacoteSelecionado, setPacoteSelecionado] = useState<Pacote | null>(null)
    const [tipoInc, setTipoInc] = useState('avaria')
    const [descInc, setDescInc] = useState('')
    const [salvandoInc, setSalvandoInc] = useState(false)

    useEffect(() => {
        async function init() {
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) { router.push('/login'); return }
            setOperatorId(user.id)

            const { data: userData } = await supabase
                .from('users').select('company_id, name').eq('id', user.id).single()
            if (!userData) return
            setCompanyId(userData.company_id)
            setOperatorName(userData.name)
            await carregarDados(userData.company_id)
        }
        init()
    }, [])

    async function carregarDados(cid: string) {
        setLoading(true)

        const [pkgsRes, extraviosRes, incRes] = await Promise.all([
            supabase.from('packages')
                .select('id, barcode, status, created_at, clients(name)')
                .eq('company_id', cid)
                .in('status', ['in_warehouse', 'unsuccessful', 'incident'])
                .order('created_at', { ascending: true }),
            supabase.from('packages')
                .select('id, barcode, status, created_at, clients(name)')
                .eq('company_id', cid)
                .eq('status', 'extravio')
                .order('created_at', { ascending: true }),
            supabase.from('incidents')
                .select('*, packages(status)')
                .eq('company_id', cid)
                .order('created_at', { ascending: false })
        ])

        const agora = new Date()
        const pkgs = (pkgsRes.data || []).map((p: any) => ({
            ...p,
            diasParado: Math.floor((agora.getTime() - new Date(p.created_at).getTime()) / 86400000)
        }))

        const extraviosPkgs = (extraviosRes.data || []).map((p: any) => ({
            ...p,
            diasParado: Math.floor((agora.getTime() - new Date(p.created_at).getTime()) / 86400000)
        }))

        setEstoque(pkgs.filter((p: any) => p.status === 'in_warehouse'))
        setParados(pkgs.filter((p: any) => p.status === 'in_warehouse' && p.diasParado >= 3))
        setParadosMotorista(pkgs.filter((p: any) => p.status === 'unsuccessful'))
        setExtravios(extraviosPkgs)
        const incsFiltrados = (incRes.data || []).filter(
            (i: any) => i.packages?.status !== 'lost'
        )
        setIncidentes(incsFiltrados)
        setLoading(false)
    }

    async function abrirIncidente() {
        if (!pacoteSelecionado) return
        setSalvandoInc(true)

        await supabase.from('packages')
            .update({ status: 'incident' })
            .eq('id', pacoteSelecionado.id)

        await supabase.from('package_events').insert({
            package_id: pacoteSelecionado.id,
            company_id: companyId,
            event_type: 'incident',
            operator_id: operatorId,
            operator_name: operatorName,
        })

        await supabase.from('incidents').insert({
            company_id: companyId,
            package_id: pacoteSelecionado.id,
            barcode: pacoteSelecionado.barcode,
            type: tipoInc,
            description: descInc || null,
            operator_id: operatorId,
            operator_name: operatorName,
            status: 'aberto'
        })

        setSalvandoInc(false)
        setModalIncidente(false)
        setPacoteSelecionado(null)
        setTipoInc('avaria')
        setDescInc('')
        await carregarDados(companyId)
    }

    async function atualizarStatusIncidente(id: string, novoStatus: string) {
        await supabase.from('incidents').update({
            status: novoStatus,
            resolved_at: novoStatus === 'resolvido' ? new Date().toISOString() : null
        }).eq('id', id)
        await carregarDados(companyId)
    }

    async function marcarComoLost(pkg: Pacote) {
        const confirmar = window.confirm(`Confirma marcar ${pkg.barcode} como LOST (perda definitiva)?`)
        if (!confirmar) return

        await supabase.from('packages').update({ status: 'lost' }).eq('id', pkg.id)
        await supabase.from('package_events').insert({
            package_id: pkg.id,
            company_id: companyId,
            event_type: 'lost',
            operator_id: operatorId,
            operator_name: operatorName,
            outcome_notes: 'Marcado como Lost após prazo de 6 dias em extravio'
        })
        await carregarDados(companyId)
    }

    function corDias(dias: number) {
        if (dias >= 6) return '#ff5252'
        if (dias >= 3) return '#ffb300'
        return '#00e676'
    }

    function bgDias(dias: number) {
        if (dias >= 6) return '#2b0d0d'
        if (dias >= 3) return '#2b1f0d'
        return '#0d2b1a'
    }

    function diasExtravio(created_at: string) {
        const dias = Math.floor((Date.now() - new Date(created_at).getTime()) / 86400000)
        return dias
    }

    const estoquePorCliente = estoque.reduce((acc: Record<string, { nome: string, total: number, criticos: number, alertas: number }>, p) => {
        const nome = (p.clients as any)?.name || 'Sem cliente'
        if (!acc[nome]) acc[nome] = { nome, total: 0, criticos: 0, alertas: 0 }
        acc[nome].total++
        if (p.diasParado >= 6) acc[nome].criticos++
        else if (p.diasParado >= 3) acc[nome].alertas++
        return acc
    }, {})

    const extraviosCriticos = extravios.filter(p => diasExtravio(p.created_at) >= 6)

    return (
        <main className="min-h-screen p-6" style={{ backgroundColor: '#0f1923' }}>
            <div className="max-w-3xl mx-auto">
                <button onClick={() => router.push('/dashboard')}
                    className="text-slate-400 text-sm mb-6 hover:text-white">← Voltar</button>

                <h1 className="text-white font-black tracking-widest uppercase text-xl mb-6">
                    🏭 Armazém
                </h1>

                {/* Abas */}
                <div className="flex gap-2 mb-6 flex-wrap">
                    {[
                        { key: 'estoque', label: `Estoque (${estoque.length})` },
                        { key: 'parados', label: `Parados (${parados.length})` },
                        { key: 'incidentes', label: `Incidentes (${incidentes.filter(i => i.status !== 'resolvido').length})` },
                        {
                            key: 'extravio',
                            label: `Extravio (${extravios.length})`,
                            alerta: extraviosCriticos.length > 0
                        },
                    ].map((a: any) => (
                        <button key={a.key} onClick={() => setAba(a.key as any)}
                            className="px-5 py-2 rounded font-black tracking-widest uppercase text-sm outline-none"
                            style={{
                                backgroundColor: aba === a.key ? '#00b4b4' : a.alerta ? '#2b0d0d' : '#1a2736',
                                color: a.alerta && aba !== a.key ? '#ff5252' : 'white',
                                border: a.alerta && aba !== a.key ? '1px solid #ff5252' : 'none'
                            }}>
                            {a.label}
                        </button>
                    ))}
                </div>

                {loading ? (
                    <p className="text-slate-400 text-sm">Carregando...</p>
                ) : (
                    <>
                        {/* ─── ESTOQUE ─── */}
                        {aba === 'estoque' && (
                            <div className="flex flex-col gap-4">
                                <div className="grid grid-cols-2 gap-3">
                                    {Object.values(estoquePorCliente).map(c => (
                                        <div key={c.nome} className="rounded-lg p-4"
                                            style={{ backgroundColor: '#1a2736' }}>
                                            <p className="text-white font-bold">{c.nome}</p>
                                            <p className="text-3xl font-black text-white mt-1">{c.total}</p>
                                            <div className="flex gap-3 mt-2 text-xs font-bold">
                                                {c.criticos > 0 && <span style={{ color: '#ff5252' }}>🔴 {c.criticos} críticos</span>}
                                                {c.alertas > 0 && <span style={{ color: '#ffb300' }}>🟡 {c.alertas} alerta</span>}
                                                {c.criticos === 0 && c.alertas === 0 && <span style={{ color: '#00e676' }}>✅ OK</span>}
                                            </div>
                                        </div>
                                    ))}
                                    {Object.keys(estoquePorCliente).length === 0 && (
                                        <div className="col-span-2 rounded-lg p-8 text-center" style={{ backgroundColor: '#1a2736' }}>
                                            <p className="text-slate-400">Nenhum pacote no armazém</p>
                                        </div>
                                    )}
                                </div>

                                {estoque.length > 0 && (
                                    <div className="rounded-lg p-5" style={{ backgroundColor: '#1a2736' }}>
                                        <p className="text-xs font-bold tracking-widest uppercase text-slate-400 mb-3">
                                            Todos os Pacotes — {estoque.length}
                                        </p>
                                        <div className="flex flex-col gap-2 max-h-96 overflow-y-auto">
                                            {estoque.map(p => (
                                                <div key={p.id} className="flex items-center justify-between p-3 rounded"
                                                    style={{ backgroundColor: '#0f1923' }}>
                                                    <div>
                                                        <p className="text-white font-mono text-sm">{p.barcode}</p>
                                                        <p className="text-slate-400 text-xs">{(p.clients as any)?.name || '-'}</p>
                                                    </div>
                                                    <div className="flex items-center gap-2">
                                                        <span className="px-2 py-1 rounded text-xs font-bold"
                                                            style={{ backgroundColor: bgDias(p.diasParado), color: corDias(p.diasParado) }}>
                                                            {p.diasParado}d
                                                        </span>
                                                        {p.diasParado >= 3 && (
                                                            <button onClick={() => { setPacoteSelecionado(p); setModalIncidente(true) }}
                                                                className="px-2 py-1 rounded text-xs font-bold"
                                                                style={{ backgroundColor: '#2b0d0d', color: '#ff5252', border: '1px solid #ff5252' }}>
                                                                + Incidente
                                                            </button>
                                                        )}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* ─── PARADOS ─── */}
                        {aba === 'parados' && (
                            <div className="flex flex-col gap-4">
                                <div className="rounded-lg p-5" style={{ backgroundColor: '#1a2736' }}>
                                    <p className="text-xs font-bold tracking-widest uppercase text-slate-400 mb-3">
                                        Parados no Armazém — {parados.length}
                                    </p>
                                    {parados.length === 0 ? (
                                        <p className="text-slate-500 text-sm">Nenhum pacote parado</p>
                                    ) : (
                                        <div className="flex flex-col gap-2">
                                            {parados.map(p => (
                                                <div key={p.id} className="flex items-center justify-between p-3 rounded"
                                                    style={{ backgroundColor: '#0f1923' }}>
                                                    <div>
                                                        <p className="text-white font-mono text-sm">{p.barcode}</p>
                                                        <p className="text-slate-400 text-xs">
                                                            {(p.clients as any)?.name || '-'} · Desde {new Date(p.created_at).toLocaleDateString('pt-BR')}
                                                        </p>
                                                    </div>
                                                    <div className="flex items-center gap-2">
                                                        <span className="px-3 py-1 rounded text-xs font-bold"
                                                            style={{ backgroundColor: bgDias(p.diasParado), color: corDias(p.diasParado) }}>
                                                            {p.diasParado} dias
                                                        </span>
                                                        <button onClick={() => { setPacoteSelecionado(p); setModalIncidente(true) }}
                                                            className="px-2 py-1 rounded text-xs font-bold"
                                                            style={{ backgroundColor: '#2b0d0d', color: '#ff5252', border: '1px solid #ff5252' }}>
                                                            + Incidente
                                                        </button>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>

                                <div className="rounded-lg p-5" style={{ backgroundColor: '#1a2736' }}>
                                    <p className="text-xs font-bold tracking-widest uppercase text-slate-400 mb-1">
                                        Insucessos Aguardando Retorno — {paradosMotorista.length}
                                    </p>
                                    <p className="text-xs text-slate-500 mb-3">
                                        Pacotes que saíram com motorista e não foram entregues
                                    </p>
                                    {paradosMotorista.length === 0 ? (
                                        <p className="text-slate-500 text-sm">Nenhum pacote pendente</p>
                                    ) : (
                                        <div className="flex flex-col gap-2">
                                            {paradosMotorista.map(p => (
                                                <div key={p.id} className="flex items-center justify-between p-3 rounded"
                                                    style={{ backgroundColor: '#0f1923' }}>
                                                    <div>
                                                        <p className="text-white font-mono text-sm">{p.barcode}</p>
                                                        <p className="text-slate-400 text-xs">{(p.clients as any)?.name || '-'}</p>
                                                    </div>
                                                    <span className="px-3 py-1 rounded text-xs font-bold"
                                                        style={{ backgroundColor: '#2b0d0d', color: '#ff5252' }}>
                                                        ❌ Insucesso
                                                    </span>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* ─── INCIDENTES ─── */}
                        {aba === 'incidentes' && (
                            <div className="flex flex-col gap-3">
                                {incidentes.length === 0 ? (
                                    <div className="rounded-lg p-8 text-center" style={{ backgroundColor: '#1a2736' }}>
                                        <p className="text-slate-400">Nenhum incidente registrado</p>
                                    </div>
                                ) : (
                                    incidentes.map(inc => (
                                        <div key={inc.id} className="rounded-lg p-4" style={{ backgroundColor: '#1a2736' }}>
                                            <div className="flex items-start justify-between mb-2">
                                                <div>
                                                    <p className="text-white font-mono font-bold">{inc.barcode}</p>
                                                    <p className="text-slate-400 text-xs mt-1">
                                                        {tipoIncidente[inc.type]} · {new Date(inc.created_at).toLocaleDateString('pt-BR')}
                                                    </p>
                                                    {inc.description && (
                                                        <p className="text-slate-300 text-xs mt-1">{inc.description}</p>
                                                    )}
                                                    {inc.operator_name && (
                                                        <p className="text-slate-500 text-xs mt-1">👤 {inc.operator_name}</p>
                                                    )}
                                                </div>
                                                <select value={inc.status}
                                                    onChange={e => atualizarStatusIncidente(inc.id, e.target.value)}
                                                    className="px-2 py-1 rounded text-xs font-bold outline-none"
                                                    style={{
                                                        backgroundColor: statusIncidente[inc.status]?.bg,
                                                        color: statusIncidente[inc.status]?.color,
                                                        border: `1px solid ${statusIncidente[inc.status]?.color}`
                                                    }}>
                                                    <option value="aberto">Aberto</option>
                                                    <option value="em_analise">Em Análise</option>
                                                    <option value="resolvido">Resolvido</option>
                                                </select>
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                        )}

                        {/* ─── EXTRAVIO ─── */}
                        {aba === 'extravio' && (
                            <div className="flex flex-col gap-3">

                                {extraviosCriticos.length > 0 && (
                                    <div className="rounded-lg p-4"
                                        style={{ backgroundColor: '#2b0d0d', border: '1px solid #ff5252' }}>
                                        <p className="text-xs font-bold tracking-widest uppercase mb-1" style={{ color: '#ff5252' }}>
                                            ⚠️ {extraviosCriticos.length} pacote(s) com 6+ dias — prontos para Lost
                                        </p>
                                        <p className="text-xs text-slate-400">
                                            Esses pacotes passaram do prazo de 6 dias. Confirme o Lost para encerrar o ciclo.
                                        </p>
                                    </div>
                                )}

                                {extravios.length === 0 ? (
                                    <div className="rounded-lg p-8 text-center" style={{ backgroundColor: '#1a2736' }}>
                                        <p className="text-slate-400">Nenhum pacote em extravio</p>
                                    </div>
                                ) : (
                                    <div className="rounded-lg p-5" style={{ backgroundColor: '#1a2736' }}>
                                        <p className="text-xs font-bold tracking-widest uppercase text-slate-400 mb-1">
                                            Em Extravio — {extravios.length} pacotes
                                        </p>
                                        <p className="text-xs text-slate-500 mb-3">
                                            Para localizar um pacote, bipe-o no Recebimento. O status será encerrado automaticamente.
                                        </p>
                                        <div className="flex flex-col gap-2">
                                            {extravios.map(p => {
                                                const dias = diasExtravio(p.created_at)
                                                const critico = dias >= 6
                                                return (
                                                    <div key={p.id} className="flex items-center justify-between p-3 rounded"
                                                        style={{ backgroundColor: '#0f1923', border: critico ? '1px solid #ff5252' : 'none' }}>
                                                        <div>
                                                            <p className="text-white font-mono text-sm">{p.barcode}</p>
                                                            <p className="text-slate-400 text-xs">
                                                                {(p.clients as any)?.name || '-'} · Extravio há {dias} dia(s)
                                                            </p>
                                                        </div>
                                                        <div className="flex items-center gap-2">
                                                            <span className="px-2 py-1 rounded text-xs font-bold"
                                                                style={{
                                                                    backgroundColor: critico ? '#2b0d0d' : '#2b1f0d',
                                                                    color: critico ? '#ff5252' : '#ffb300'
                                                                }}>
                                                                {dias}d
                                                            </span>
                                                            {critico && (
                                                                <button onClick={() => marcarComoLost(p)}
                                                                    className="px-2 py-1 rounded text-xs font-bold"
                                                                    style={{ backgroundColor: '#2b0d0d', color: '#ff5252', border: '1px solid #ff5252' }}>
                                                                    💀 Lost
                                                                </button>
                                                            )}
                                                        </div>
                                                    </div>
                                                )
                                            })}
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                    </>
                )}
            </div>

            {/* Modal Incidente */}
            {modalIncidente && pacoteSelecionado && (
                <div className="fixed inset-0 flex items-center justify-center z-50 p-4"
                    style={{ backgroundColor: 'rgba(0,0,0,0.8)' }}>
                    <div className="w-full max-w-md rounded-lg p-6 flex flex-col gap-4"
                        style={{ backgroundColor: '#1a2736' }}>
                        <div className="flex justify-between items-center">
                            <h2 className="text-white font-black tracking-widest uppercase">Abrir Incidente</h2>
                            <button onClick={() => setModalIncidente(false)}
                                className="text-slate-400 hover:text-white">✕</button>
                        </div>

                        <div className="px-3 py-2 rounded" style={{ backgroundColor: '#0f1923' }}>
                            <p className="text-white font-mono text-sm">{pacoteSelecionado.barcode}</p>
                            <p className="text-slate-400 text-xs">
                                {(pacoteSelecionado.clients as any)?.name} · {pacoteSelecionado.diasParado} dias parado
                            </p>
                        </div>

                        <div className="flex flex-col gap-1">
                            <label className="text-xs font-bold tracking-widest uppercase text-slate-400">
                                Tipo de Incidente
                            </label>
                            <select value={tipoInc} onChange={e => setTipoInc(e.target.value)}
                                className="px-4 py-3 rounded text-white text-sm outline-none"
                                style={{ backgroundColor: '#0f1923', border: '1px solid #2a3f52' }}>
                                {Object.entries(tipoIncidente).map(([key, label]) => (
                                    <option key={key} value={key}>{label}</option>
                                ))}
                            </select>
                        </div>

                        <div className="flex flex-col gap-1">
                            <label className="text-xs font-bold tracking-widest uppercase text-slate-400">
                                Descrição (opcional)
                            </label>
                            <textarea value={descInc} onChange={e => setDescInc(e.target.value)}
                                placeholder="Descreva o que aconteceu..."
                                rows={3}
                                className="px-4 py-3 rounded text-white text-sm outline-none resize-none"
                                style={{ backgroundColor: '#0f1923', border: '1px solid #2a3f52' }} />
                        </div>

                        <button onClick={abrirIncidente} disabled={salvandoInc}
                            className="py-3 rounded font-black tracking-widest uppercase text-white text-sm disabled:opacity-50"
                            style={{ backgroundColor: '#c0392b' }}>
                            {salvandoInc ? 'Salvando...' : 'Confirmar Incidente'}
                        </button>
                    </div>
                </div>
            )}
        </main>
    )
}