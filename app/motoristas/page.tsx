'use client'

import { useState, useEffect } from 'react'
import { createClient } from '../lib/supabase'
import { useRouter } from 'next/navigation'

type Motorista = {
    id: string
    name: string
    cpf: string | null
    license_plate: string
    vehicle_type: string
    status: string
    blocked_reason: string | null
    active: boolean
    created_at: string
}

type Rota = {
    id: string
    created_at: string
    driver_name: string
    packages: { barcode: string; status: string }
}

const statusConfig: Record<string, { label: string; color: string; bg: string }> = {
    active: { label: 'Ativo', color: '#00e676', bg: '#0d2b1a' },
    inactive: { label: 'Inativo', color: '#94a3b8', bg: '#1a2736' },
    blocked: { label: 'Bloqueado', color: '#ff5252', bg: '#2b0d0d' },
}

const veiculoIcon: Record<string, string> = {
    passeio: '🚗', utilitario: '🚐', van: '🚌',
    truck: '🚛', carreta: '🚚', moto: '🏍️', outros: '🚘'
}

export default function MotoristasPage() {
    const router = useRouter()
    const supabase = createClient()

    const [companyId, setCompanyId] = useState('')
    const [motoristas, setMotoristas] = useState<Motorista[]>([])
    const [loading, setLoading] = useState(true)

    const [filtroStatus, setFiltroStatus] = useState<'todos' | 'active' | 'inactive' | 'blocked'>('todos')
    const [busca, setBusca] = useState('')

    const [expandido, setExpandido] = useState<string | null>(null)
    const [editando, setEditando] = useState<string | null>(null)
    const [rotas, setRotas] = useState<any[]>([])
    const [loadingRotas, setLoadingRotas] = useState(false)

    // Edição
    const [nomeEdit, setNomeEdit] = useState('')
    const [cpfEdit, setCpfEdit] = useState('')
    const [placaEdit, setPlacaEdit] = useState('')
    const [veiculoEdit, setVeiculoEdit] = useState('')
    const [motivoBloqueio, setMotivoBloqueio] = useState('')
    const [salvando, setSalvando] = useState(false)

    const [erro, setErro] = useState('')
    const [sucesso, setSucesso] = useState('')

    useEffect(() => {
        async function init() {
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) { router.push('/login'); return }

            const { data: userData } = await supabase
                .from('users').select('company_id').eq('id', user.id).single()
            if (!userData) return
            setCompanyId(userData.company_id)
            await carregarMotoristas(userData.company_id)
        }
        init()
    }, [])

    async function carregarMotoristas(cid: string) {
        setLoading(true)
        const { data } = await supabase
            .from('drivers').select('*')
            .eq('company_id', cid)
            .order('name')
        setMotoristas(data || [])
        setLoading(false)
    }

    async function carregarRotas(driverId: string) {
        setLoadingRotas(true)
        const { data } = await supabase
            .from('package_events')
            .select('id, created_at, driver_name, packages(barcode, status)')
            .eq('driver_id', driverId)
            .eq('event_type', 'dispatched')
            .order('created_at', { ascending: false })
            .limit(20)
        setRotas(data || [])
        setLoadingRotas(false)
    }

    function msg(tipo: 'ok' | 'erro', texto: string) {
        if (tipo === 'ok') { setSucesso(texto); setTimeout(() => setSucesso(''), 3000) }
        else { setErro(texto); setTimeout(() => setErro(''), 3000) }
    }

    function abrirEdicao(mot: Motorista) {
        setEditando(mot.id)
        setNomeEdit(mot.name)
        setCpfEdit(mot.cpf || '')
        setPlacaEdit(mot.license_plate)
        setVeiculoEdit(mot.vehicle_type)
        setMotivoBloqueio(mot.blocked_reason || '')
    }

    async function salvarEdicao() {
        if (!editando) return
        if (!nomeEdit.trim() || !placaEdit.trim()) {
            msg('erro', 'Nome e placa são obrigatórios')
            return
        }
        setSalvando(true)
        const { error } = await supabase.from('drivers').update({
            name: nomeEdit.trim(),
            cpf: cpfEdit.trim() || null,
            license_plate: placaEdit.trim().toUpperCase(),
            vehicle_type: veiculoEdit,
        }).eq('id', editando)

        if (error) msg('erro', 'Erro ao salvar')
        else { msg('ok', 'Motorista atualizado'); setEditando(null) }
        setSalvando(false)
        await carregarMotoristas(companyId)
    }

    async function alterarStatus(mot: Motorista, novoStatus: string) {
        if (novoStatus === 'blocked' && !motivoBloqueio.trim()) {
            msg('erro', 'Informe o motivo do bloqueio')
            return
        }
        setSalvando(true)
        await supabase.from('drivers').update({
            status: novoStatus,
            active: novoStatus === 'active',
            blocked_reason: novoStatus === 'blocked' ? motivoBloqueio.trim() : null
        }).eq('id', mot.id)
        msg('ok', 'Status atualizado')
        setSalvando(false)
        setEditando(null)
        await carregarMotoristas(companyId)
    }

    function toggleExpandido(id: string) {
        if (expandido === id) {
            setExpandido(null)
            setRotas([])
        } else {
            setExpandido(id)
            carregarRotas(id)
        }
        setEditando(null)
    }

    const motoristasFiltrados = motoristas.filter(m => {
        const statusOk = filtroStatus === 'todos' || m.status === filtroStatus
        const buscaOk = busca === '' ||
            m.name.toLowerCase().includes(busca.toLowerCase()) ||
            m.license_plate.toLowerCase().includes(busca.toLowerCase()) ||
            (m.cpf || '').includes(busca)
        return statusOk && buscaOk
    })

    const kpis = {
        total: motoristas.length,
        ativos: motoristas.filter(m => m.status === 'active').length,
        inativos: motoristas.filter(m => m.status === 'inactive').length,
        bloqueados: motoristas.filter(m => m.status === 'blocked').length,
    }

    const statusRota: Record<string, { label: string; color: string }> = {
        delivered: { label: 'Entregue', color: '#00e676' },
        unsuccessful: { label: 'Insucesso', color: '#ff5252' },
        dispatched: { label: 'Em Rota', color: '#00b4b4' },
        returned: { label: 'Devolvido', color: '#ffb300' },
        extravio: { label: 'Extravio', color: '#ff5252' },
        lost: { label: 'Lost', color: '#94a3b8' },
    }

    return (
        <main className="min-h-screen p-6" style={{ backgroundColor: '#0f1923' }}>
            <div className="max-w-3xl mx-auto">
                <button onClick={() => router.push('/dashboard')}
                    className="text-slate-400 text-sm mb-6 hover:text-white">← Voltar</button>

                <h1 className="text-white font-black tracking-widest uppercase text-xl mb-6">
                    🚗 Motoristas
                </h1>

                {sucesso && (
                    <div className="rounded p-3 mb-4 text-sm font-bold"
                        style={{ backgroundColor: '#0d2b1a', color: '#00e676', border: '1px solid #00e676' }}>
                        ✅ {sucesso}
                    </div>
                )}
                {erro && (
                    <div className="rounded p-3 mb-4 text-sm font-bold"
                        style={{ backgroundColor: '#2b0d0d', color: '#ff5252', border: '1px solid #ff5252' }}>
                        ❌ {erro}
                    </div>
                )}

                {/* KPIs */}
                <div className="grid grid-cols-4 gap-3 mb-6">
                    {[
                        { label: 'Total', value: kpis.total, color: 'white', bg: '#1a2736', filtro: 'todos' },
                        { label: 'Ativos', value: kpis.ativos, color: '#00e676', bg: '#0d2b1a', filtro: 'active' },
                        { label: 'Inativos', value: kpis.inativos, color: '#94a3b8', bg: '#1a2736', filtro: 'inactive' },
                        { label: 'Bloqueados', value: kpis.bloqueados, color: '#ff5252', bg: '#2b0d0d', filtro: 'blocked' },
                    ].map(k => (
                        <button key={k.filtro}
                            onClick={() => setFiltroStatus(filtroStatus === k.filtro ? 'todos' : k.filtro as any)}
                            className="rounded-lg p-3 text-center outline-none"
                            style={{
                                backgroundColor: k.bg,
                                border: filtroStatus === k.filtro ? `2px solid ${k.color}` : `1px solid ${k.color}33`
                            }}>
                            <p className="text-2xl font-black" style={{ color: k.color }}>{k.value}</p>
                            <p className="text-xs font-bold tracking-widest uppercase mt-1" style={{ color: k.color }}>
                                {k.label}
                            </p>
                        </button>
                    ))}
                </div>

                {/* Busca */}
                <div className="mb-4">
                    <input value={busca} onChange={e => setBusca(e.target.value)}
                        placeholder="Buscar por nome, placa ou CPF..."
                        className="w-full px-4 py-3 rounded text-white text-sm outline-none"
                        style={{ backgroundColor: '#1a2736', border: '1px solid #2a3f52' }} />
                </div>

                {/* Lista */}
                {loading ? (
                    <p className="text-slate-400 text-sm">Carregando...</p>
                ) : motoristasFiltrados.length === 0 ? (
                    <div className="rounded-lg p-8 text-center" style={{ backgroundColor: '#1a2736' }}>
                        <p className="text-slate-400">Nenhum motorista encontrado</p>
                    </div>
                ) : (
                    <div className="flex flex-col gap-3">
                        {motoristasFiltrados.map(mot => (
                            <div key={mot.id} className="rounded-lg overflow-hidden"
                                style={{
                                    backgroundColor: '#1a2736',
                                    border: mot.status === 'blocked' ? '1px solid #ff5252' : '1px solid #1a2736'
                                }}>

                                {/* Header */}
                                <div className="flex items-center justify-between p-4">
                                    <div className="flex items-center gap-3">
                                        <span className="text-2xl">{veiculoIcon[mot.vehicle_type] || '🚘'}</span>
                                        <div>
                                            <div className="flex items-center gap-2">
                                                <p className="text-white font-bold">{mot.name}</p>
                                                <span className="px-2 py-0.5 rounded text-xs font-bold"
                                                    style={{
                                                        backgroundColor: statusConfig[mot.status]?.bg,
                                                        color: statusConfig[mot.status]?.color
                                                    }}>
                                                    {statusConfig[mot.status]?.label}
                                                </span>
                                            </div>
                                            <p className="text-slate-400 text-xs">
                                                {mot.license_plate} · {mot.vehicle_type}
                                                {mot.cpf && ` · ${mot.cpf}`}
                                            </p>
                                            {mot.blocked_reason && (
                                                <p className="text-xs mt-0.5" style={{ color: '#ff5252' }}>
                                                    🚫 {mot.blocked_reason}
                                                </p>
                                            )}
                                        </div>
                                    </div>
                                    <div className="flex gap-2">
                                        <button onClick={() => abrirEdicao(mot)}
                                            className="px-3 py-1 rounded text-xs font-bold outline-none"
                                            style={{ backgroundColor: '#0f1923', color: '#00b4b4', border: '1px solid #00b4b4' }}>
                                            Editar
                                        </button>
                                        <button onClick={() => toggleExpandido(mot.id)}
                                            className="px-3 py-1 rounded text-xs font-bold outline-none"
                                            style={{ backgroundColor: '#0f1923', color: '#94a3b8', border: '1px solid #2a3f52' }}>
                                            {expandido === mot.id ? '▲' : '▼'}
                                        </button>
                                    </div>
                                </div>

                                {/* Edição */}
                                {editando === mot.id && (
                                    <div className="px-4 pb-4 border-t flex flex-col gap-3"
                                        style={{ borderColor: '#0f1923' }}>
                                        <p className="text-xs font-bold tracking-widest uppercase text-slate-400 mt-3">
                                            Editar Dados
                                        </p>
                                        <input value={nomeEdit} onChange={e => setNomeEdit(e.target.value)}
                                            placeholder="Nome *"
                                            className="px-4 py-2 rounded text-white text-sm outline-none"
                                            style={{ backgroundColor: '#0f1923', border: '1px solid #2a3f52' }} />
                                        <input value={cpfEdit} onChange={e => setCpfEdit(e.target.value)}
                                            placeholder="CPF"
                                            className="px-4 py-2 rounded text-white text-sm outline-none"
                                            style={{ backgroundColor: '#0f1923', border: '1px solid #2a3f52' }} />
                                        <input value={placaEdit} onChange={e => setPlacaEdit(e.target.value.toUpperCase())}
                                            placeholder="Placa *"
                                            className="px-4 py-2 rounded text-white text-sm outline-none"
                                            style={{ backgroundColor: '#0f1923', border: '1px solid #2a3f52' }} />
                                        <select value={veiculoEdit} onChange={e => setVeiculoEdit(e.target.value)}
                                            className="px-4 py-2 rounded text-white text-sm outline-none"
                                            style={{ backgroundColor: '#0f1923', border: '1px solid #2a3f52' }}>
                                            {['passeio', 'utilitario', 'van', 'truck', 'carreta', 'moto', 'outros'].map(v => (
                                                <option key={v} value={v}>{v}</option>
                                            ))}
                                        </select>

                                        <div className="flex gap-2">
                                            <button onClick={salvarEdicao} disabled={salvando}
                                                className="flex-1 py-2 rounded font-black tracking-widest uppercase text-white text-sm disabled:opacity-50"
                                                style={{ backgroundColor: '#00b4b4' }}>
                                                {salvando ? 'Salvando...' : 'Salvar'}
                                            </button>
                                            <button onClick={() => setEditando(null)}
                                                className="px-4 py-2 rounded font-black tracking-widest uppercase text-white text-sm"
                                                style={{ backgroundColor: '#0f1923', border: '1px solid #2a3f52' }}>
                                                Cancelar
                                            </button>
                                        </div>

                                        {/* Status */}
                                        <p className="text-xs font-bold tracking-widest uppercase text-slate-400">
                                            Alterar Status
                                        </p>
                                        <div className="flex gap-2">
                                            <button onClick={() => alterarStatus(mot, 'active')} disabled={salvando}
                                                className="flex-1 py-2 rounded text-xs font-bold tracking-widest uppercase disabled:opacity-50"
                                                style={{ backgroundColor: '#0d2b1a', color: '#00e676', border: '1px solid #00e676' }}>
                                                Ativo
                                            </button>
                                            <button onClick={() => alterarStatus(mot, 'inactive')} disabled={salvando}
                                                className="flex-1 py-2 rounded text-xs font-bold tracking-widest uppercase disabled:opacity-50"
                                                style={{ backgroundColor: '#1a2736', color: '#94a3b8', border: '1px solid #94a3b8' }}>
                                                Inativo
                                            </button>
                                        </div>

                                        <input value={motivoBloqueio} onChange={e => setMotivoBloqueio(e.target.value)}
                                            placeholder="Motivo do bloqueio (obrigatório para bloquear)"
                                            className="px-4 py-2 rounded text-white text-sm outline-none"
                                            style={{ backgroundColor: '#0f1923', border: '1px solid #2a3f52' }} />
                                        <button onClick={() => alterarStatus(mot, 'blocked')}
                                            disabled={salvando || !motivoBloqueio.trim()}
                                            className="py-2 rounded font-black tracking-widest uppercase text-white text-sm disabled:opacity-30"
                                            style={{ backgroundColor: '#c0392b' }}>
                                            🚫 Bloquear
                                        </button>
                                    </div>
                                )}

                                {/* Histórico de rotas */}
                                {expandido === mot.id && (
                                    <div className="px-4 pb-4 border-t" style={{ borderColor: '#0f1923' }}>
                                        <p className="text-xs font-bold tracking-widest uppercase text-slate-400 mt-3 mb-3">
                                            Últimas 20 Rotas
                                        </p>
                                        {loadingRotas ? (
                                            <p className="text-slate-500 text-sm">Carregando...</p>
                                        ) : rotas.length === 0 ? (
                                            <p className="text-slate-500 text-sm">Nenhuma rota registrada</p>
                                        ) : (
                                            <div className="flex flex-col gap-2 max-h-64 overflow-y-auto">
                                                {rotas.map((r: any) => (
                                                    <div key={r.id} className="flex items-center justify-between p-2 rounded text-xs"
                                                        style={{ backgroundColor: '#0f1923' }}>
                                                        <span className="text-white font-mono">
                                                            {(r.packages as any)?.barcode || '-'}
                                                        </span>
                                                        <div className="flex items-center gap-3">
                                                            <span style={{
                                                                color: statusRota[(r.packages as any)?.status]?.color || '#94a3b8'
                                                            }}>
                                                                {statusRota[(r.packages as any)?.status]?.label || (r.packages as any)?.status}
                                                            </span>
                                                            <span className="text-slate-500">
                                                                {new Date(r.created_at).toLocaleDateString('pt-BR')}
                                                            </span>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </main>
    )
}