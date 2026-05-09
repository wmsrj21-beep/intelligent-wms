'use client'

import { useState, useEffect } from 'react'
import { createClient } from '../lib/supabase'
import { useRouter } from 'next/navigation'
import * as XLSX from 'xlsx'

type Evento = {
    id: string
    event_type: string
    operator_name: string | null
    driver_name: string | null
    location: string | null
    outcome: string | null
    outcome_notes: string | null
    has_divergence: boolean
    divergence_type: string | null
    divergence_notes: string | null
    created_at: string
}

type Pacote = {
    id: string
    barcode: string
    status: string
    created_at: string
    clients: { name: string } | null
    company_id: string
    companies?: { name: string; code: string | null } | null
    package_events: Evento[]
    incidents?: { type: string; description: string | null; status: string }[]
}

const statusLabel: Record<string, { label: string; color: string }> = {
    in_warehouse: { label: '📦 No Armazém', color: '#00b4b4' },
    dispatched: { label: '🚚 Expedido', color: '#ffb300' },
    delivered: { label: '✅ Entregue', color: '#00e676' },
    unsuccessful: { label: '⚠️ Insucesso', color: '#ff5252' },
    returned: { label: '↩️ Devolvido', color: '#ffb300' },
    incident: { label: '🚨 Incidente', color: '#ff5252' },
    extravio: { label: '❓ Extravio', color: '#ff5252' },
    lost: { label: '💀 Lost', color: '#94a3b8' },
    devolvido_cliente: { label: '📤 Devolvido ao Cliente', color: '#00e676' },
}

const eventLabel: Record<string, string> = {
    received: '📥 Recebido',
    moved: '🔄 Movido',
    picked: '🤚 Separado',
    dispatched: '🚚 Expedido',
    delivered: '✅ Entregue',
    unsuccessful: '⚠️ Insucesso',
    returned: '↩️ Devolvido',
    incident: '🚨 Incidente',
    extravio: '❓ Extravio',
    lost: '💀 Lost',
    localized: '🔍 Localizado',
    transferred: '🔄 Transferido',
    devolucao_cliente: '📤 Devolvido ao Cliente',
}

const tipoIncidenteLabel: Record<string, string> = {
    avaria: '💥 Avaria',
    extravio: '❓ Extravio',
    roubo: '🚨 Roubo',
    lost: '💀 Lost',
    endereco_errado: '📍 Endereço Errado',
    cliente_recusou: '🚫 Cliente Recusou',
    outros: '📝 Outros'
}

function hojeFormatado(): string {
    return new Date().toLocaleDateString('pt-BR', {
        timeZone: 'America/Sao_Paulo',
        year: 'numeric', month: '2-digit', day: '2-digit'
    }).split('/').reverse().join('-')
}

function toISOStart(data: string): string {
    return `${data}T03:00:00.000Z`
}

function toISOEnd(data: string): string {
    const [ano, mes, dia] = data.split('-').map(Number)
    return new Date(Date.UTC(ano, mes - 1, dia + 1, 2, 59, 59, 999)).toISOString()
}

function formatDate(dt: string) {
    return new Date(dt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
}

const SELECT_PACOTE = `
    id, barcode, status, created_at, company_id,
    clients(name),
    companies(name, code),
    package_events(
        id, event_type, operator_name, driver_name,
        location, outcome, outcome_notes,
        has_divergence, divergence_type, divergence_notes,
        created_at
    ),
    incidents(type, description, status)
`

export default function RastrearPage() {
    const router = useRouter()
    const supabase = createClient()

    const [companyId, setCompanyId] = useState('')
    const [isSuperAdmin, setIsSuperAdmin] = useState(false)
    const [motoristasLista, setMotoristasLista] = useState<any[]>([])

    const [modo, setModo] = useState<'codigo' | 'lote' | 'periodo' | 'status' | 'motorista'>('codigo')

    const [barcode, setBarcode] = useState('')
    const [loteTexto, setLoteTexto] = useState('')
    const [dataInicio, setDataInicio] = useState(hojeFormatado())
    const [dataFim, setDataFim] = useState(hojeFormatado())
    const [statusFiltro, setStatusFiltro] = useState('')
    const [motoristaFiltro, setMotoristaFiltro] = useState('')
    const [statusDataInicio, setStatusDataInicio] = useState(hojeFormatado())
    const [statusDataFim, setStatusDataFim] = useState(hojeFormatado())

    const [pacote, setPacote] = useState<Pacote | null>(null)
    const [pacotes, setPacotes] = useState<Pacote[]>([])
    const [expandido, setExpandido] = useState<string | null>(null)
    const [erro, setErro] = useState('')
    const [loading, setLoading] = useState(false)

    useEffect(() => {
        async function init() {
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) return
            const { data: userData } = await supabase
                .from('users').select('company_id, cargo').eq('id', user.id).single()
            if (!userData) return
            setCompanyId(userData.company_id)
            setIsSuperAdmin(userData.cargo === 'super_admin' || userData.cargo === 'admin')
            const { data: motoristas } = await supabase
                .from('drivers').select('id, name').eq('company_id', userData.company_id).order('name')
            setMotoristasLista(motoristas || [])
        }
        init()
    }, [])

    // Busca pacotes em lotes sem limite
    async function fetchAllPacotes(buildQ: (from: number, to: number) => any): Promise<any[]> {
        const BATCH = 1000
        let from = 0
        let all: any[] = []
        while (true) {
            const { data } = await buildQ(from, from + BATCH - 1)
            if (!data || data.length === 0) break
            all = [...all, ...data]
            if (data.length < BATCH) break
            from += BATCH
        }
        return all
    }

    // Busca eventos em lotes sem limite
    async function fetchAllEventos(buildQ: (from: number, to: number) => any): Promise<any[]> {
        const BATCH = 1000
        let from = 0
        let all: any[] = []
        while (true) {
            const { data } = await buildQ(from, from + BATCH - 1)
            if (!data || data.length === 0) break
            all = [...all, ...data]
            if (data.length < BATCH) break
            from += BATCH
        }
        return all
    }

    function sortEventos(pkgs: any[]): any[] {
        return pkgs.map(p => ({
            ...p,
            package_events: [...(p.package_events || [])].sort(
                (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
            )
        }))
    }

    async function buscarPorCodigo() {
        if (!barcode.trim()) return
        setLoading(true); setErro(''); setPacote(null); setPacotes([])

        const { data } = await supabase
            .from('packages')
            .select(SELECT_PACOTE)
            .eq('barcode', barcode.trim())
            .single()

        setLoading(false)
        if (!data) { setErro('Pacote não encontrado.'); return }
        setPacote({
            ...data,
            package_events: [...data.package_events].sort(
                (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
            )
        } as any)
    }

    async function buscarPorLote() {
        const codigos = loteTexto.split(/[\n,;]+/).map(c => c.trim()).filter(Boolean)
        if (codigos.length === 0) return
        if (codigos.length > 1000) { setErro('Máximo de 1000 códigos por vez'); return }
        setLoading(true); setErro(''); setPacote(null); setPacotes([])
        const cid = companyId
        if (!cid) { setErro('Aguarde o carregamento.'); setLoading(false); return }

        const data = await fetchAllPacotes((from, to) =>
            supabase.from('packages').select(SELECT_PACOTE)
                .in('barcode', codigos)
                .eq('company_id', cid)
                .range(from, to)
        )

        setLoading(false)
        if (!data || data.length === 0) { setErro('Nenhum pacote encontrado.'); return }
        setPacotes(sortEventos(data) as any)
    }

    async function buscarPorPeriodo() {
        if (!dataInicio || !dataFim) { setErro('Informe as duas datas'); return }
        setLoading(true); setErro(''); setPacote(null); setPacotes([])
        const cid = companyId
        if (!cid) { setErro('Aguarde o carregamento.'); setLoading(false); return }

        const inicio = toISOStart(dataInicio)
        const fim = toISOEnd(dataFim)

        const data = await fetchAllPacotes((from, to) =>
            supabase.from('packages').select(SELECT_PACOTE)
                .eq('company_id', cid)
                .gte('created_at', inicio)
                .lte('created_at', fim)
                .order('created_at', { ascending: false })
                .range(from, to)
        )

        setLoading(false)
        if (!data || data.length === 0) { setErro('Nenhum pacote encontrado.'); return }
        setPacotes(sortEventos(data) as any)
    }

    async function buscarPorStatus() {
        if (!statusFiltro) { setErro('Selecione um status'); return }
        if (!statusDataInicio || !statusDataFim) { setErro('Informe o período'); return }
        setLoading(true); setErro(''); setPacote(null); setPacotes([])
        const cid = companyId
        if (!cid) { setErro('Aguarde o carregamento.'); setLoading(false); return }

        const inicio = toISOStart(statusDataInicio)
        const fim = toISOEnd(statusDataFim)

        if (statusFiltro === 'geral') {
            const eventos = await fetchAllEventos((from, to) =>
                supabase.from('package_events')
                    .select(`
                        id, event_type, operator_name, driver_name, outcome_notes, created_at,
                        packages(barcode, status, clients(name), companies(name, code))
                    `)
                    .eq('company_id', cid)
                    .gte('created_at', inicio)
                    .lte('created_at', fim)
                    .order('created_at', { ascending: true })
                    .range(from, to)
            )

            setLoading(false)
            if (!eventos || eventos.length === 0) { setErro('Nenhum evento encontrado no período.'); return }

            const rows = eventos.map((e: any) => ({
                'Data/Hora': formatDate(e.created_at),
                'Código': e.packages?.barcode || '-',
                'Status Pacote': statusLabel[e.packages?.status]?.label || e.packages?.status || '-',
                'Cliente': e.packages?.clients?.name || '-',
                'Base': e.packages?.companies?.code
                    ? `${e.packages.companies.code} — ${e.packages.companies.name}`
                    : e.packages?.companies?.name || '-',
                'Evento': eventLabel[e.event_type] || e.event_type,
                'Operador': e.operator_name || '-',
                'Motorista': e.driver_name || '-',
                'Observação': e.outcome_notes || '-',
            }))

            const wb = XLSX.utils.book_new()
            const ws = XLSX.utils.json_to_sheet(rows)
            ws['!cols'] = [
                { wch: 20 }, { wch: 20 }, { wch: 20 }, { wch: 15 },
                { wch: 25 }, { wch: 22 }, { wch: 20 }, { wch: 20 }, { wch: 30 }
            ]
            XLSX.utils.book_append_sheet(wb, ws, 'Geral')
            XLSX.writeFile(wb, `relatorio_geral_${statusDataInicio}_${statusDataFim}.xlsx`)
            return
        }

        const data = await fetchAllPacotes((from, to) =>
            supabase.from('packages').select(SELECT_PACOTE)
                .eq('company_id', cid)
                .eq('status', statusFiltro)
                .gte('updated_at', inicio)
                .lte('updated_at', fim)
                .order('updated_at', { ascending: false })
                .range(from, to)
        )

        setLoading(false)
        if (!data || data.length === 0) { setErro('Nenhum pacote encontrado.'); return }
        setPacotes(sortEventos(data) as any)
    }

    async function buscarPorMotorista() {
        if (!motoristaFiltro) { setErro('Selecione um motorista'); return }
        setLoading(true); setErro(''); setPacote(null); setPacotes([])
        const cid = companyId
        if (!cid) { setErro('Aguarde o carregamento.'); setLoading(false); return }

        const eventos = await fetchAllEventos((from, to) =>
            supabase.from('package_events')
                .select('package_id')
                .eq('driver_id', motoristaFiltro)
                .eq('company_id', cid)
                .range(from, to)
        )

        if (!eventos || eventos.length === 0) {
            setErro('Nenhum pacote encontrado para este motorista.')
            setLoading(false); return
        }

        const pkgIds = [...new Set(eventos.map((e: any) => e.package_id))]

        const data = await fetchAllPacotes((from, to) =>
            supabase.from('packages').select(SELECT_PACOTE)
                .in('id', pkgIds)
                .order('created_at', { ascending: false })
                .range(from, to)
        )

        setLoading(false)
        if (!data || data.length === 0) { setErro('Nenhum pacote encontrado.'); return }
        setPacotes(sortEventos(data) as any)
    }

    function executarBusca() {
        if (modo === 'codigo') buscarPorCodigo()
        else if (modo === 'lote') buscarPorLote()
        else if (modo === 'periodo') buscarPorPeriodo()
        else if (modo === 'status') buscarPorStatus()
        else if (modo === 'motorista') buscarPorMotorista()
    }

    function exportarExcel() {
        const lista = pacote ? [pacote] : pacotes
        if (lista.length === 0) return

        const rows = lista.map(p => ({
            'Código': p.barcode,
            'Status': statusLabel[p.status]?.label || p.status,
            'Cliente': (p.clients as any)?.name || '-',
            'Base': (p.companies as any)?.code
                ? `${(p.companies as any).code} — ${(p.companies as any).name}`
                : (p.companies as any)?.name || '-',
            'Entrada': formatDate(p.created_at),
            'Eventos': p.package_events.length,
            'Último Evento': p.package_events.length > 0
                ? eventLabel[p.package_events[p.package_events.length - 1].event_type] || '-'
                : '-',
            'Último Operador': p.package_events.length > 0
                ? p.package_events[p.package_events.length - 1].operator_name || '-'
                : '-',
            'Último Motorista': p.package_events.length > 0
                ? p.package_events[p.package_events.length - 1].driver_name || '-'
                : '-',
        }))

        const wb = XLSX.utils.book_new()
        const ws = XLSX.utils.json_to_sheet(rows)
        ws['!cols'] = [
            { wch: 20 }, { wch: 20 }, { wch: 15 }, { wch: 20 },
            { wch: 20 }, { wch: 8 }, { wch: 20 }, { wch: 20 }, { wch: 20 }
        ]
        XLSX.utils.book_append_sheet(wb, ws, 'Rastreamento')
        XLSX.writeFile(wb, `rastreamento_${new Date().toISOString().slice(0, 10)}.xlsx`)
    }

    function renderEventoLabel(ev: Evento, incidentes?: { type: string; description: string | null; status: string }[]) {
        if (ev.event_type === 'incident' && incidentes && incidentes.length > 0) {
            const tipo = tipoIncidenteLabel[incidentes[0].type] || incidentes[0].type
            return `🚨 Incidente — ${tipo}`
        }
        return eventLabel[ev.event_type] || ev.event_type
    }

    function renderEventoNotes(ev: Evento, incidentes?: { type: string; description: string | null; status: string }[]) {
        if (ev.event_type === 'incident' && incidentes && incidentes.length > 0) {
            return incidentes[0].description || null
        }
        return ev.outcome_notes || null
    }

    const totalResultados = pacote ? 1 : pacotes.length

    return (
        <main className="min-h-screen p-6" style={{ backgroundColor: '#0f1923' }}>
            <div className="max-w-3xl mx-auto">
                <button onClick={() => router.push('/dashboard')}
                    className="text-slate-400 text-sm mb-6 hover:text-white">← Voltar</button>

                <h1 className="text-white font-black tracking-widest uppercase text-xl mb-6">
                    🔍 Rastrear
                </h1>

                <div className="flex gap-2 mb-4 flex-wrap">
                    {[
                        { key: 'codigo', label: 'Código' },
                        { key: 'lote', label: 'Lote' },
                        { key: 'periodo', label: 'Período' },
                        { key: 'status', label: 'Status' },
                        { key: 'motorista', label: 'Motorista' },
                    ].map(m => (
                        <button key={m.key}
                            onClick={() => { setModo(m.key as any); setErro(''); setPacote(null); setPacotes([]) }}
                            className="px-4 py-2 rounded font-black tracking-widest uppercase text-sm outline-none"
                            style={{ backgroundColor: modo === m.key ? '#00b4b4' : '#1a2736', color: 'white' }}>
                            {m.label}
                        </button>
                    ))}
                </div>

                <div className="rounded-lg p-5 mb-4" style={{ backgroundColor: '#1a2736' }}>
                    {modo === 'codigo' && (
                        <div className="flex gap-3">
                            <input type="text" value={barcode}
                                onChange={e => setBarcode(e.target.value)}
                                onKeyDown={e => e.key === 'Enter' && buscarPorCodigo()}
                                placeholder="Digite ou bipe o código"
                                className="flex-1 px-4 py-3 rounded text-white text-sm outline-none"
                                style={{ backgroundColor: '#0f1923', border: '1px solid #2a3f52' }}
                                autoFocus />
                        </div>
                    )}

                    {modo === 'lote' && (
                        <div className="flex flex-col gap-2">
                            <label className="text-xs font-bold tracking-widest uppercase text-slate-400">
                                Cole os códigos (um por linha, ou separados por vírgula) — máx. 1000
                            </label>
                            <textarea value={loteTexto}
                                onChange={e => setLoteTexto(e.target.value)}
                                placeholder={'TBR123456\nTBR789012\nTBR345678'}
                                rows={6}
                                className="px-4 py-3 rounded text-white text-sm outline-none resize-none font-mono"
                                style={{ backgroundColor: '#0f1923', border: '1px solid #2a3f52' }} />
                            <p className="text-xs text-slate-500">
                                {loteTexto.split(/[\n,;]+/).filter(c => c.trim()).length} códigos
                            </p>
                        </div>
                    )}

                    {modo === 'periodo' && (
                        <div className="flex gap-3 flex-wrap">
                            <div className="flex flex-col gap-1 flex-1">
                                <label className="text-xs font-bold tracking-widest uppercase text-slate-400">De</label>
                                <input type="date" value={dataInicio}
                                    onChange={e => setDataInicio(e.target.value)}
                                    className="px-4 py-3 rounded text-white text-sm outline-none"
                                    style={{ backgroundColor: '#0f1923', border: '1px solid #2a3f52', colorScheme: 'dark' }} />
                            </div>
                            <div className="flex flex-col gap-1 flex-1">
                                <label className="text-xs font-bold tracking-widest uppercase text-slate-400">Até</label>
                                <input type="date" value={dataFim}
                                    onChange={e => setDataFim(e.target.value)}
                                    className="px-4 py-3 rounded text-white text-sm outline-none"
                                    style={{ backgroundColor: '#0f1923', border: '1px solid #2a3f52', colorScheme: 'dark' }} />
                            </div>
                        </div>
                    )}

                    {modo === 'status' && (
                        <div className="flex flex-col gap-3">
                            <div className="flex gap-3 flex-wrap">
                                <div className="flex flex-col gap-1 flex-1">
                                    <label className="text-xs font-bold tracking-widest uppercase text-slate-400">De</label>
                                    <input type="date" value={statusDataInicio}
                                        onChange={e => setStatusDataInicio(e.target.value)}
                                        max={hojeFormatado()}
                                        className="px-4 py-3 rounded text-white text-sm outline-none"
                                        style={{ backgroundColor: '#0f1923', border: '1px solid #2a3f52', colorScheme: 'dark' }} />
                                </div>
                                <div className="flex flex-col gap-1 flex-1">
                                    <label className="text-xs font-bold tracking-widest uppercase text-slate-400">Até</label>
                                    <input type="date" value={statusDataFim}
                                        onChange={e => setStatusDataFim(e.target.value)}
                                        max={hojeFormatado()}
                                        className="px-4 py-3 rounded text-white text-sm outline-none"
                                        style={{ backgroundColor: '#0f1923', border: '1px solid #2a3f52', colorScheme: 'dark' }} />
                                </div>
                            </div>
                            <select value={statusFiltro} onChange={e => setStatusFiltro(e.target.value)}
                                className="w-full px-4 py-3 rounded text-white text-sm outline-none"
                                style={{ backgroundColor: '#0f1923', border: '1px solid #2a3f52' }}>
                                <option value="">Selecione o status</option>
                                <option value="geral">📊 Geral — todos os eventos</option>
                                {Object.entries(statusLabel).map(([key, val]) => (
                                    <option key={key} value={key}>{val.label}</option>
                                ))}
                            </select>
                            {statusFiltro === 'geral' && (
                                <p className="text-xs text-slate-400">
                                    Exporta um Excel com todos os eventos do período, do mais antigo ao mais novo.
                                </p>
                            )}
                        </div>
                    )}

                    {modo === 'motorista' && (
                        <select value={motoristaFiltro} onChange={e => setMotoristaFiltro(e.target.value)}
                            className="w-full px-4 py-3 rounded text-white text-sm outline-none"
                            style={{ backgroundColor: '#0f1923', border: '1px solid #2a3f52' }}>
                            <option value="">Selecione o motorista</option>
                            {motoristasLista.map(m => (
                                <option key={m.id} value={m.id}>{m.name}</option>
                            ))}
                        </select>
                    )}

                    <button onClick={executarBusca} disabled={loading}
                        className="w-full mt-3 py-3 rounded font-black tracking-widest uppercase text-white text-sm disabled:opacity-50"
                        style={{ backgroundColor: '#00b4b4' }}>
                        {loading ? 'Buscando...' : statusFiltro === 'geral' ? '⬇️ Gerar Excel' : '🔍 Buscar'}
                    </button>
                </div>

                {erro && (
                    <div className="rounded p-4 mb-4 text-sm font-bold"
                        style={{ backgroundColor: '#2b0d0d', color: '#ff5252', border: '1px solid #ff5252' }}>
                        {erro}
                    </div>
                )}

                {totalResultados > 0 && (
                    <div className="flex items-center justify-between mb-4">
                        <p className="text-slate-400 text-sm">
                            <span className="text-white font-bold">{totalResultados}</span> resultado{totalResultados !== 1 ? 's' : ''}
                        </p>
                        <button onClick={exportarExcel}
                            className="px-4 py-2 rounded font-black tracking-widest uppercase text-sm"
                            style={{ backgroundColor: '#00b4b4', color: 'white' }}>
                            ⬇️ Excel
                        </button>
                    </div>
                )}

                {pacote && (
                    <div className="flex flex-col gap-4">
                        <div className="rounded-lg p-5" style={{ backgroundColor: '#1a2736' }}>
                            <div className="flex items-start justify-between">
                                <div>
                                    <p className="text-xs font-bold tracking-widest uppercase text-slate-400 mb-1">Código</p>
                                    <p className="text-white font-black text-xl font-mono">{pacote.barcode}</p>
                                </div>
                                <span className="px-3 py-1 rounded text-xs font-bold"
                                    style={{ backgroundColor: '#0f1923', color: statusLabel[pacote.status]?.color || '#00b4b4' }}>
                                    {statusLabel[pacote.status]?.label || pacote.status}
                                </span>
                            </div>
                            <div className="mt-4 flex gap-6 flex-wrap">
                                <div>
                                    <p className="text-xs text-slate-400">Cliente</p>
                                    <p className="text-white font-bold text-sm">{(pacote.clients as any)?.name || '-'}</p>
                                </div>
                                <div>
                                    <p className="text-xs text-slate-400">Base</p>
                                    <p className="text-white font-bold text-sm">
                                        {(pacote.companies as any)?.code
                                            ? `${(pacote.companies as any).code} — ${(pacote.companies as any).name}`
                                            : (pacote.companies as any)?.name || '-'}
                                    </p>
                                </div>
                                <div>
                                    <p className="text-xs text-slate-400">Entrada</p>
                                    <p className="text-white font-bold text-sm">{formatDate(pacote.created_at)}</p>
                                </div>
                            </div>
                        </div>

                        <div className="rounded-lg p-5" style={{ backgroundColor: '#1a2736' }}>
                            <p className="text-xs font-bold tracking-widest uppercase text-slate-400 mb-4">
                                Histórico Completo
                            </p>
                            <div className="flex flex-col gap-0">
                                {pacote.package_events.map((ev, i) => {
                                    const notes = renderEventoNotes(ev, pacote.incidents)
                                    return (
                                        <div key={ev.id} className="flex gap-4">
                                            <div className="flex flex-col items-center">
                                                <div className="w-3 h-3 rounded-full mt-1 flex-shrink-0"
                                                    style={{ backgroundColor: '#00b4b4' }} />
                                                {i < pacote.package_events.length - 1 && (
                                                    <div className="w-px flex-1 my-1" style={{ backgroundColor: '#2a3f52' }} />
                                                )}
                                            </div>
                                            <div className="pb-4 flex-1">
                                                <div className="flex items-center justify-between">
                                                    <p className="text-white font-bold text-sm">
                                                        {renderEventoLabel(ev, pacote.incidents)}
                                                    </p>
                                                    <p className="text-slate-500 text-xs">{formatDate(ev.created_at)}</p>
                                                </div>
                                                {ev.operator_name && <p className="text-slate-400 text-xs mt-1">👤 {ev.operator_name}</p>}
                                                {ev.driver_name && <p className="text-slate-400 text-xs mt-1">🚗 {ev.driver_name}</p>}
                                                {ev.location && <p className="text-slate-400 text-xs mt-1">📍 {ev.location}</p>}
                                                {notes && <p className="text-slate-400 text-xs mt-1">📝 {notes}</p>}
                                                {ev.has_divergence && (
                                                    <div className="mt-2 px-3 py-2 rounded text-xs"
                                                        style={{ backgroundColor: '#2b1f0d', color: '#ffb300', border: '1px solid #ffb300' }}>
                                                        ⚠️ {ev.divergence_type} — {ev.divergence_notes}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    )
                                })}
                            </div>
                        </div>
                    </div>
                )}

                {pacotes.length > 0 && (
                    <div className="flex flex-col gap-2">
                        {pacotes.map(p => (
                            <div key={p.id} className="rounded-lg overflow-hidden" style={{ backgroundColor: '#1a2736' }}>
                                <button
                                    onClick={() => setExpandido(expandido === p.id ? null : p.id)}
                                    className="w-full p-4 text-left outline-none">
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <p className="text-white font-mono font-bold">{p.barcode}</p>
                                            <p className="text-slate-400 text-xs mt-1">
                                                {(p.clients as any)?.name || '-'}
                                                {(p.companies as any)?.code && ` · ${(p.companies as any).code}`}
                                                {` · ${formatDate(p.created_at)}`}
                                            </p>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <span className="px-2 py-1 rounded text-xs font-bold"
                                                style={{ backgroundColor: '#0f1923', color: statusLabel[p.status]?.color || '#00b4b4' }}>
                                                {statusLabel[p.status]?.label || p.status}
                                            </span>
                                            <span className="text-slate-400 text-xs">
                                                {expandido === p.id ? '▲' : '▼'}
                                            </span>
                                        </div>
                                    </div>
                                </button>

                                {expandido === p.id && (
                                    <div className="px-4 pb-4 border-t" style={{ borderColor: '#0f1923' }}>
                                        <p className="text-xs font-bold tracking-widest uppercase text-slate-400 mt-3 mb-3">
                                            Histórico
                                        </p>
                                        <div className="flex flex-col gap-0">
                                            {p.package_events.map((ev, i) => {
                                                const notes = renderEventoNotes(ev, p.incidents)
                                                return (
                                                    <div key={ev.id} className="flex gap-3">
                                                        <div className="flex flex-col items-center">
                                                            <div className="w-2 h-2 rounded-full mt-1.5 flex-shrink-0"
                                                                style={{ backgroundColor: '#00b4b4' }} />
                                                            {i < p.package_events.length - 1 && (
                                                                <div className="w-px flex-1 my-1" style={{ backgroundColor: '#2a3f52' }} />
                                                            )}
                                                        </div>
                                                        <div className="pb-3 flex-1">
                                                            <div className="flex items-center justify-between">
                                                                <p className="text-white text-xs font-bold">
                                                                    {renderEventoLabel(ev, p.incidents)}
                                                                </p>
                                                                <p className="text-slate-500 text-xs">{formatDate(ev.created_at)}</p>
                                                            </div>
                                                            <div className="text-slate-400 text-xs mt-0.5 flex gap-3 flex-wrap">
                                                                {ev.operator_name && <span>👤 {ev.operator_name}</span>}
                                                                {ev.driver_name && <span>🚗 {ev.driver_name}</span>}
                                                                {ev.location && <span>📍 {ev.location}</span>}
                                                                {notes && <span>📝 {notes}</span>}
                                                            </div>
                                                        </div>
                                                    </div>
                                                )
                                            })}
                                        </div>
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