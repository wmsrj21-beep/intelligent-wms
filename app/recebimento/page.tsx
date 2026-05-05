'use client'

import { useState, useRef, useEffect } from 'react'
import { createClient } from '../lib/supabase'
import { useRouter } from 'next/navigation'
import * as XLSX from 'xlsx'
import { somSucesso, somErro, somAlerta, somLocalizado, somTransferido } from '../lib/sounds'

type Pacote = {
    barcode: string
    status: 'ok' | 'inconsistente' | 'localizado' | 'transferido'
}

type Resultado = {
    recebidos: string[]
    faltantes: string[]
    inconsistentes: string[]
    localizados: string[]
    transferidos: string[]
}

type Base = {
    id: string
    name: string
    code: string | null
}

// Status que bloqueiam entrada no recebimento
const STATUS_BLOQUEADOS: Record<string, string> = {
    dispatched: '🚚 Pacote ainda em rota com motorista. Processe o retorno antes de receber.',
    extravio: '❓ Pacote em extravio. Use o módulo Localizar para recuperá-lo.',
    lost: '💀 Pacote marcado como Lost. Não pode ser recebido.',
}

export default function RecebimentoPage() {
    const router = useRouter()
    const supabase = createClient()
    const inputRef = useRef<HTMLInputElement>(null)

    const [bases, setBases] = useState<Base[]>([])
    const [baseSelecionada, setBaseSelecionada] = useState('')
    const [baseNome, setBaseNome] = useState('')
    const [clientes, setClientes] = useState<any[]>([])
    const [clienteId, setClienteId] = useState('')
    const [companyId, setCompanyId] = useState('')
    const [operatorId, setOperatorId] = useState('')
    const [operatorName, setOperatorName] = useState('')
    const [isSuperAdmin, setIsSuperAdmin] = useState(false)

    const [manifesto, setManifesto] = useState<string[]>([])
    const [manifestoNome, setManifestoNome] = useState('')
    const [bipados, setBipados] = useState<Pacote[]>([])
    const [barcode, setBarcode] = useState('')
    const [fase, setFase] = useState<'setup' | 'bipando' | 'resultado'>('setup')
    const [resultado, setResultado] = useState<Resultado | null>(null)
    const [feedback, setFeedback] = useState<{ msg: string; tipo: 'ok' | 'erro' | 'alerta' } | null>(null)

    useEffect(() => {
        async function init() {
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) { router.push('/login'); return }
            setOperatorId(user.id)

            const { data: userData } = await supabase
                .from('users').select('company_id, name, cargo').eq('id', user.id).single()
            if (!userData) return

            setCompanyId(userData.company_id)
            setOperatorName(userData.name)

            const isSA = userData.cargo === 'super_admin' || userData.cargo === 'admin'
            setIsSuperAdmin(isSA)

            if (isSA) {
                const { data: basesData } = await supabase
                    .from('companies').select('id, name, code').eq('active', true).order('name')
                setBases(basesData || [])
            } else {
                const { data: basesData } = await supabase
                    .from('user_bases')
                    .select('company_id, companies(id, name, code)')
                    .eq('user_id', user.id)

                const basesDoUser = basesData?.map((ub: any) => ub.companies).filter(Boolean) || []
                if (basesDoUser.length === 0) {
                    const { data: companyData } = await supabase
                        .from('companies').select('id, name, code').eq('id', userData.company_id).single()
                    if (companyData) {
                        setBases([companyData])
                        setBaseSelecionada(companyData.id)
                        setBaseNome(companyData.code ? `${companyData.code} — ${companyData.name}` : companyData.name)
                        await carregarClientes(companyData.id)
                    }
                } else {
                    setBases(basesDoUser)
                    if (basesDoUser.length === 1) {
                        setBaseSelecionada(basesDoUser[0].id)
                        setBaseNome(basesDoUser[0].code ? `${basesDoUser[0].code} — ${basesDoUser[0].name}` : basesDoUser[0].name)
                        await carregarClientes(basesDoUser[0].id)
                    }
                }
            }
        }
        init()
    }, [])

    async function carregarClientes(baseId: string) {
        const { data } = await supabase
            .from('clients').select('*')
            .eq('company_id', baseId)
            .eq('active', true)
            .order('name')
        setClientes(data || [])
        setClienteId('')
    }

    async function handleBaseChange(baseId: string) {
        setBaseSelecionada(baseId)
        const base = bases.find(b => b.id === baseId)
        setBaseNome(base ? (base.code ? `${base.code} — ${base.name}` : base.name) : '')
        await carregarClientes(baseId)
    }

    function handleUploadManifesto(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0]
        if (!file) return
        setManifestoNome(file.name)

        const reader = new FileReader()
        reader.onload = (evt) => {
            const data = evt.target?.result
            const workbook = XLSX.read(data, { type: 'binary' })
            const sheet = workbook.Sheets[workbook.SheetNames[0]]
            const rows: any[] = XLSX.utils.sheet_to_json(sheet, { header: 1 })
            const codigos = rows
                .flat()
                .map((v: any) => String(v).trim())
                .filter(v => v && v !== 'undefined')
            setManifesto(codigos)
        }
        reader.readAsBinaryString(file)
    }

    function iniciarRecebimento() {
        if (!baseSelecionada) { alert('Selecione a base'); return }
        if (!clienteId) { alert('Selecione o cliente'); return }
        setFase('bipando')
        setTimeout(() => inputRef.current?.focus(), 100)
    }

    async function handleBipe(e: React.KeyboardEvent<HTMLInputElement>) {
        if (e.key !== 'Enter') return
        const codigo = barcode.trim()
        if (!codigo) return
        setBarcode('')

        const jaBipado = bipados.find(b => b.barcode === codigo)
        if (jaBipado) {
            somAlerta()
            setFeedback({ msg: `⚠️ ${codigo} já foi bipado`, tipo: 'alerta' })
            setTimeout(() => setFeedback(null), 2000)
            return
        }

        // Busca o pacote sem filtro de status para poder bloquear corretamente
        const { data: pkgsEncontrados } = await supabase
            .from('packages')
            .select('id, status, company_id')
            .eq('barcode', codigo)
            .order('created_at', { ascending: false })
            .limit(1)

        const pkgExistente = pkgsEncontrados?.[0] || null

        // ─── BLOQUEIO: dispatched, extravio, lost ───
        if (pkgExistente && STATUS_BLOQUEADOS[pkgExistente.status]) {
            somErro()
            setFeedback({ msg: `❌ ${codigo} — ${STATUS_BLOQUEADOS[pkgExistente.status]}`, tipo: 'erro' })
            setTimeout(() => setFeedback(null), 4000)
            inputRef.current?.focus()
            return
        }

        // Pacote em extravio na mesma base — localizar (não deve chegar aqui pois bloqueamos acima, mas mantemos para segurança)
        // Esse bloco agora só seria atingido se removêssemos extravio do bloqueio no futuro

        // Pacote existe em OUTRA base — transferência
        if (pkgExistente && pkgExistente.company_id !== baseSelecionada) {
            const baseOrigem = pkgExistente.company_id
            await supabase.from('package_events').insert({
                package_id: pkgExistente.id, company_id: baseOrigem,
                event_type: 'transferred', operator_id: operatorId,
                operator_name: operatorName, location: baseNome,
                outcome_notes: `Transferido para ${baseNome}`
            })
            await supabase.from('packages').update({
                company_id: baseSelecionada, client_id: clienteId, status: 'in_warehouse'
            }).eq('id', pkgExistente.id)
            await supabase.from('package_events').insert({
                package_id: pkgExistente.id, company_id: baseSelecionada,
                event_type: 'received', operator_id: operatorId,
                operator_name: operatorName, location: baseNome,
                outcome_notes: 'Recebido por transferência'
            })
            somTransferido()
            setBipados(prev => [...prev, { barcode: codigo, status: 'transferido' }])
            setFeedback({ msg: `🔄 ${codigo} — Transferido e recebido em ${baseNome}`, tipo: 'ok' })
            setTimeout(() => setFeedback(null), 2000)
            inputRef.current?.focus()
            return
        }

        // Pacote existe na mesma base — entrada normal
        if (pkgExistente) {
            const noStatus: 'ok' | 'inconsistente' = manifesto.includes(codigo) ? 'ok' : 'inconsistente'
            setBipados(prev => [...prev, { barcode: codigo, status: noStatus }])
            await supabase.from('packages').update({ status: 'in_warehouse' }).eq('id', pkgExistente.id)
            await supabase.from('package_events').insert({
                package_id: pkgExistente.id, company_id: baseSelecionada,
                event_type: 'received', operator_id: operatorId,
                operator_name: operatorName, location: baseNome,
            })
            if (noStatus === 'ok') somSucesso()
            else somAlerta()
            setFeedback({
                msg: noStatus === 'ok' ? `✅ ${codigo}` : `⚠️ ${codigo} — não estava no manifesto`,
                tipo: noStatus === 'ok' ? 'ok' : 'alerta'
            })
            setTimeout(() => setFeedback(null), 1500)
            inputRef.current?.focus()
            return
        }

        // Pacote novo — inserir
        const noStatus: 'ok' | 'inconsistente' = manifesto.includes(codigo) ? 'ok' : 'inconsistente'
        setBipados(prev => [...prev, { barcode: codigo, status: noStatus }])
        const { data: pkg } = await supabase.from('packages').insert({
            company_id: baseSelecionada, client_id: clienteId,
            barcode: codigo, status: 'in_warehouse'
        }).select().single()
        if (pkg) {
            await supabase.from('package_events').insert({
                package_id: pkg.id, company_id: baseSelecionada,
                event_type: 'received', operator_id: operatorId,
                operator_name: operatorName, location: baseNome,
            })
        }
        if (noStatus === 'ok') somSucesso()
        else somAlerta()
        setFeedback({
            msg: noStatus === 'ok' ? `✅ ${codigo}` : `⚠️ ${codigo} — não estava no manifesto`,
            tipo: noStatus === 'ok' ? 'ok' : 'alerta'
        })
        setTimeout(() => setFeedback(null), 1500)
        inputRef.current?.focus()
    }

    function finalizarRecebimento() {
        const bipedosCodigos = bipados.map(b => b.barcode)
        const recebidos = bipedosCodigos.filter(c =>
            manifesto.includes(c) && bipados.find(b => b.barcode === c)?.status === 'ok'
        )
        const faltantes = manifesto.filter(c => !bipedosCodigos.includes(c))
        const inconsistentes = bipedosCodigos.filter(c =>
            bipados.find(b => b.barcode === c)?.status === 'inconsistente'
        )
        const localizados = bipados.filter(b => b.status === 'localizado').map(b => b.barcode)
        const transferidos = bipados.filter(b => b.status === 'transferido').map(b => b.barcode)
        setResultado({ recebidos, faltantes, inconsistentes, localizados, transferidos })
        setFase('resultado')
    }

    function exportarRelatorio() {
        if (!resultado) return
        const wb = XLSX.utils.book_new()
        const rows = [
            ...resultado.recebidos.map(c => ({ Codigo: c, Status: 'Recebido', Base: baseNome })),
            ...resultado.faltantes.map(c => ({ Codigo: c, Status: 'Faltante', Base: baseNome })),
            ...resultado.inconsistentes.map(c => ({ Codigo: c, Status: 'Inconsistente', Base: baseNome })),
            ...(resultado.localizados || []).map(c => ({ Codigo: c, Status: 'Localizado (era Extravio)', Base: baseNome })),
            ...(resultado.transferidos || []).map(c => ({ Codigo: c, Status: 'Transferido', Base: baseNome })),
        ]
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Relatório')
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
            resultado.faltantes.map(c => ({ Codigo: c, Status: 'Faltante' }))
        ), 'Faltantes')
        XLSX.writeFile(wb, `recebimento_${new Date().toISOString().slice(0, 10)}.xlsx`)
    }

    const progresso = manifesto.length > 0
        ? Math.min(100, Math.round((bipados.filter(b => b.status === 'ok').length / manifesto.length) * 100))
        : 0

    // ─── SETUP ───
    if (fase === 'setup') return (
        <main className="min-h-screen p-6" style={{ backgroundColor: '#0f1923' }}>
            <div className="max-w-lg mx-auto">
                <button onClick={() => router.push('/dashboard')}
                    className="text-slate-400 text-sm mb-6 hover:text-white">← Voltar</button>
                <h1 className="text-white font-black tracking-widest uppercase text-xl mb-8">
                    📦 Recebimento
                </h1>
                <div className="rounded-lg p-6 flex flex-col gap-6" style={{ backgroundColor: '#1a2736' }}>
                    {(isSuperAdmin || bases.length > 1) && (
                        <div className="flex flex-col gap-2">
                            <label className="text-xs font-bold tracking-widest uppercase text-slate-400">Base</label>
                            <select value={baseSelecionada} onChange={e => handleBaseChange(e.target.value)}
                                className="px-4 py-3 rounded text-white text-sm outline-none"
                                style={{ backgroundColor: '#0f1923', border: '1px solid #2a3f52' }}>
                                <option value="">Selecione a base</option>
                                {bases.map(b => (
                                    <option key={b.id} value={b.id}>
                                        {b.code ? `${b.code} — ` : ''}{b.name}
                                    </option>
                                ))}
                            </select>
                        </div>
                    )}
                    <div className="flex flex-col gap-2">
                        <label className="text-xs font-bold tracking-widest uppercase text-slate-400">Cliente</label>
                        <select value={clienteId} onChange={e => setClienteId(e.target.value)}
                            className="px-4 py-3 rounded text-white text-sm outline-none"
                            style={{ backgroundColor: '#0f1923', border: '1px solid #2a3f52' }}
                            disabled={!baseSelecionada}>
                            <option value="">Selecione o cliente</option>
                            {clientes.map(c => (
                                <option key={c.id} value={c.id}>{c.name}</option>
                            ))}
                        </select>
                    </div>
                    <div className="flex flex-col gap-2">
                        <label className="text-xs font-bold tracking-widest uppercase text-slate-400">
                            Manifesto (Excel ou CSV)
                        </label>
                        <label className="flex items-center justify-center gap-3 px-4 py-3 rounded cursor-pointer text-sm font-bold tracking-widest uppercase"
                            style={{ backgroundColor: '#0f1923', border: '2px dashed #2a3f52', color: '#00b4b4' }}>
                            <span>📁 {manifestoNome || 'Escolher arquivo'}</span>
                            <input type="file" accept=".xlsx,.xls,.csv"
                                onChange={handleUploadManifesto} className="hidden" />
                        </label>
                        {manifestoNome && (
                            <p className="text-xs" style={{ color: '#00b4b4' }}>
                                ✅ {manifesto.length} códigos carregados
                            </p>
                        )}
                    </div>
                    <button onClick={iniciarRecebimento}
                        className="py-3 rounded font-black tracking-widest uppercase text-white text-sm"
                        style={{ backgroundColor: '#00b4b4' }}>
                        Iniciar Recebimento
                    </button>
                </div>
            </div>
        </main>
    )

    // ─── BIPANDO ───
    if (fase === 'bipando') return (
        <main className="min-h-screen p-6" style={{ backgroundColor: '#0f1923' }}>
            <div className="max-w-2xl mx-auto">
                <button onClick={() => router.push('/dashboard')}
                    className="text-slate-400 text-sm mb-6 hover:text-white">← Voltar</button>
                <h1 className="text-white font-black tracking-widest uppercase text-xl mb-1">
                    📦 Bipando Pacotes
                </h1>
                <p className="text-xs mb-1" style={{ color: '#00b4b4' }}>📍 {baseNome}</p>
                <p className="text-slate-400 text-sm mb-6">
                    {clientes.find(c => c.id === clienteId)?.name}
                    {manifesto.length > 0 ? ` — ${manifesto.length} esperados` : ''}
                </p>

                {manifesto.length > 0 && (
                    <div className="rounded-lg p-4 mb-4" style={{ backgroundColor: '#1a2736' }}>
                        <div className="flex justify-between text-xs text-slate-400 mb-2">
                            <span>{bipados.filter(b => b.status === 'ok').length} de {manifesto.length} conferidos</span>
                            <span>{progresso}%</span>
                        </div>
                        <div className="w-full rounded-full h-3" style={{ backgroundColor: '#0f1923' }}>
                            <div className="h-3 rounded-full transition-all duration-300"
                                style={{ width: `${progresso}%`, backgroundColor: '#00b4b4' }} />
                        </div>
                    </div>
                )}

                <div className="rounded-lg p-4 mb-4" style={{ backgroundColor: '#1a2736' }}>
                    <input ref={inputRef} type="text" value={barcode}
                        onChange={e => setBarcode(e.target.value)}
                        onKeyDown={handleBipe}
                        placeholder="Bipe ou digite o código e pressione Enter"
                        className="w-full px-4 py-4 rounded text-white text-lg outline-none"
                        style={{ backgroundColor: '#0f1923', border: '2px solid #00b4b4' }}
                        autoFocus />
                </div>

                {feedback && (
                    <div className="rounded p-3 mb-4 text-sm font-bold tracking-wide"
                        style={{
                            backgroundColor: feedback.tipo === 'ok' ? '#0d2b1a' : feedback.tipo === 'alerta' ? '#2b1f0d' : '#2b0d0d',
                            color: feedback.tipo === 'ok' ? '#00e676' : feedback.tipo === 'alerta' ? '#ffb300' : '#ff5252',
                            border: `1px solid ${feedback.tipo === 'ok' ? '#00e676' : feedback.tipo === 'alerta' ? '#ffb300' : '#ff5252'}`
                        }}>
                        {feedback.msg}
                    </div>
                )}

                <div className="rounded-lg p-4 mb-4" style={{ backgroundColor: '#1a2736' }}>
                    <p className="text-xs font-bold tracking-widest uppercase text-slate-400 mb-3">
                        Últimos bipados — {bipados.length} total
                    </p>
                    <div className="flex flex-col gap-2 max-h-48 overflow-y-auto">
                        {[...bipados].reverse().slice(0, 10).map((b, i) => (
                            <div key={i} className="flex items-center justify-between text-sm">
                                <span className="text-white font-mono">{b.barcode}</span>
                                <span className="text-xs font-bold" style={{
                                    color: b.status === 'ok' ? '#00e676' :
                                        b.status === 'localizado' ? '#00b4b4' :
                                            b.status === 'transferido' ? '#00b4b4' : '#ffb300'
                                }}>
                                    {b.status === 'ok' ? '✅ OK' :
                                        b.status === 'localizado' ? '🔍 Localizado' :
                                            b.status === 'transferido' ? '🔄 Transferido' : '⚠️ Inconsistente'}
                                </span>
                            </div>
                        ))}
                        {bipados.length === 0 && (
                            <p className="text-slate-500 text-sm">Nenhum pacote bipado ainda</p>
                        )}
                    </div>
                </div>

                <button onClick={finalizarRecebimento}
                    className="w-full py-3 rounded font-black tracking-widest uppercase text-white text-sm"
                    style={{ backgroundColor: '#c0392b' }}>
                    Finalizar Recebimento
                </button>
            </div>
        </main>
    )

    // ─── RESULTADO ───
    return (
        <main className="min-h-screen p-6" style={{ backgroundColor: '#0f1923' }}>
            <div className="max-w-2xl mx-auto">
                <h1 className="text-white font-black tracking-widest uppercase text-xl mb-1">
                    📋 Resultado do Recebimento
                </h1>
                <p className="text-xs mb-6" style={{ color: '#00b4b4' }}>📍 {baseNome}</p>
                <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 mb-6">
                    <div className="rounded-lg p-4 text-center" style={{ backgroundColor: '#0d2b1a', border: '1px solid #00e676' }}>
                        <p className="text-2xl font-black" style={{ color: '#00e676' }}>{resultado?.recebidos.length}</p>
                        <p className="text-xs font-bold tracking-widest uppercase mt-1" style={{ color: '#00e676' }}>Recebidos</p>
                    </div>
                    <div className="rounded-lg p-4 text-center" style={{ backgroundColor: '#2b0d0d', border: '1px solid #ff5252' }}>
                        <p className="text-2xl font-black" style={{ color: '#ff5252' }}>{resultado?.faltantes.length}</p>
                        <p className="text-xs font-bold tracking-widest uppercase mt-1" style={{ color: '#ff5252' }}>Faltantes</p>
                    </div>
                    <div className="rounded-lg p-4 text-center" style={{ backgroundColor: '#2b1f0d', border: '1px solid #ffb300' }}>
                        <p className="text-2xl font-black" style={{ color: '#ffb300' }}>{resultado?.inconsistentes.length}</p>
                        <p className="text-xs font-bold tracking-widest uppercase mt-1" style={{ color: '#ffb300' }}>Inconsistentes</p>
                    </div>
                    {(resultado?.localizados?.length ?? 0) > 0 && (
                        <div className="rounded-lg p-4 text-center" style={{ backgroundColor: '#0d1f2b', border: '1px solid #00b4b4' }}>
                            <p className="text-2xl font-black" style={{ color: '#00b4b4' }}>{resultado?.localizados.length}</p>
                            <p className="text-xs font-bold tracking-widest uppercase mt-1" style={{ color: '#00b4b4' }}>Localizados</p>
                        </div>
                    )}
                    {(resultado?.transferidos?.length ?? 0) > 0 && (
                        <div className="rounded-lg p-4 text-center" style={{ backgroundColor: '#0d1f2b', border: '1px solid #00b4b4' }}>
                            <p className="text-2xl font-black" style={{ color: '#00b4b4' }}>{resultado?.transferidos.length}</p>
                            <p className="text-xs font-bold tracking-widest uppercase mt-1" style={{ color: '#00b4b4' }}>Transferidos</p>
                        </div>
                    )}
                </div>
                <div className="flex gap-3">
                    <button onClick={exportarRelatorio}
                        className="flex-1 py-3 rounded font-black tracking-widest uppercase text-white text-sm"
                        style={{ backgroundColor: '#00b4b4' }}>
                        ⬇️ Baixar Relatório Excel
                    </button>
                    <button onClick={() => router.push('/dashboard')}
                        className="flex-1 py-3 rounded font-black tracking-widest uppercase text-white text-sm"
                        style={{ backgroundColor: '#1a2736', border: '1px solid #2a3f52' }}>
                        Voltar ao Dashboard
                    </button>
                </div>
            </div>
        </main>
    )
}