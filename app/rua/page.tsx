'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '../lib/supabase'
import { useRouter } from 'next/navigation'

type MotoristaStatus = {
    motorista_id: string
    motorista_nome: string
    placa: string
    total: number
    entregues: number
    insucessos: number
    em_rota: number
    sem_info: number
    pendente: boolean
}

type DetalheMotorista = {
    entregues: string[]
    insucessos: string[]
    em_rota: string[]
    sem_info: string[]
}

const STATUS_ENTREGUE = ['Delivered']
const STATUS_INSUCESSO = ['Delivery Failed']
const STATUS_AVARIA = ['Marked For Reprocess', 'Marked for problem', 'Marked For Problem']

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

export default function RuaPage() {
    const router = useRouter()
    const supabase = createClient()

    const [companyId, setCompanyId] = useState('')
    const [operatorName, setOperatorName] = useState('')
    const [motoristas, setMotoristas] = useState<MotoristaStatus[]>([])
    const [loading, setLoading] = useState(true)
    const [processando, setProcessando] = useState(false)
    const [arquivoCarregado, setArquivoCarregado] = useState(false)
    const [arquivoNome, setArquivoNome] = useState('')
    const [arquivoDados, setArquivoDados] = useState<Record<string, { status: string; reason: string }>>({})
    const [dataSelecionada, setDataSelecionada] = useState(hojeFormatado())
    const [detalhesPacotes, setDetalhesPacotes] = useState<Record<string, DetalheMotorista>>({})
    const [motoristaSelecionado, setMotoristaSelecionado] = useState<MotoristaStatus | null>(null)

    const isHoje = dataSelecionada === hojeFormatado()

    // ─── Auto-escalonamento: dispatched 3d → extravio, 6d → lost ───
    async function autoEscalarDispatchados(cid: string, opName: string) {
        // Busca todos sem limite de 1000
        let pkgsAll: any[] = []
        let from = 0
        while (true) {
            const { data: batch } = await supabase
                .from('packages')
                .select('id, company_id, created_at, updated_at')
                .eq('company_id', cid)
                .eq('status', 'dispatched')
                .range(from, from + 999)
            if (!batch || batch.length === 0) break
            pkgsAll = [...pkgsAll, ...batch]
            if (batch.length < 1000) break
            from += 1000
        }
        const pkgs = pkgsAll
        if (!pkgs || pkgs.length === 0) return

        const agora = Date.now()

        await Promise.all(pkgs.map(async (p: any) => {
            const ref = p.updated_at || p.created_at
            const dias = Math.floor((agora - new Date(ref).getTime()) / 86400000)

            if (dias >= 6) {
                await supabase.from('packages').update({ status: 'lost' }).eq('id', p.id)
                await supabase.from('package_events').insert({
                    package_id: p.id,
                    company_id: cid,
                    event_type: 'lost',
                    operator_name: opName || 'Sistema',
                    outcome_notes: 'Lost automático — 6 dias em rota sem retorno'
                })
            } else if (dias >= 3) {
                await supabase.from('packages').update({ status: 'extravio' }).eq('id', p.id)
                await supabase.from('package_events').insert({
                    package_id: p.id,
                    company_id: cid,
                    event_type: 'extravio',
                    operator_name: opName || 'Sistema',
                    outcome_notes: 'Extravio automático — 3 dias em rota sem retorno'
                })
            }
        }))
    }

    const carregarMotoristas = useCallback(async (cid: string, data: string) => {
        setLoading(true)
        const inicio = toISOStart(data)
        const fim = toISOEnd(data)

        const { data: visitas } = await supabase
            .from('vehicle_visits')
            .select('driver_id')
            .eq('company_id', cid)
            .not('departed_at', 'is', null)
            .gte('arrived_at', inicio)
            .lte('arrived_at', fim)

        const motoristasQuePartiram = new Set((visitas || []).map((v: any) => v.driver_id))

        if (motoristasQuePartiram.size === 0) {
            setMotoristas([])
            setDetalhesPacotes({})
            setLoading(false)
            return
        }

        // Busca dispatched, delivered e unsuccessful do dia — tudo em paralelo
        async function fetchAll(eventType: string, extraSelect?: string) {
            let all: any[] = []
            let from = 0
            const select = extraSelect || 'package_id'
            while (true) {
                const { data: batch } = await supabase
                    .from('package_events')
                    .select(select)
                    .eq('company_id', cid)
                    .eq('event_type', eventType)
                    .gte('created_at', inicio)
                    .lte('created_at', fim)
                    .range(from, from + 999)
                if (!batch || batch.length === 0) break
                all = [...all, ...batch]
                if (batch.length < 1000) break
                from += 1000
            }
            return all
        }

        const [eventosAll, deliveredRes, unsuccessfulRes] = await Promise.all([
            fetchAll('dispatched', 'driver_id, driver_name, package_id, packages(id, barcode), drivers(name, license_plate)'),
            fetchAll('delivered'),
            fetchAll('unsuccessful'),
        ])
        const eventos = eventosAll

        if (!eventos || eventos.length === 0) {
            setMotoristas([])
            setDetalhesPacotes({})
            setLoading(false)
            return
        }

        const entreguesNoDia = new Set(deliveredRes.map((e: any) => e.package_id))
        const insucessosNoDia = new Set(unsuccessfulRes.map((e: any) => e.package_id))

        const agrupado: Record<string, MotoristaStatus> = {}
        const detalhes: Record<string, DetalheMotorista> = {}

        for (const ev of eventos) {
            const driverId = ev.driver_id
            if (!driverId) continue
            if (!motoristasQuePartiram.has(driverId)) continue

            const barcode = (ev.packages as any)?.barcode
            const pkgId = ev.package_id
            if (!barcode || !pkgId) continue

            if (!agrupado[driverId]) {
                agrupado[driverId] = {
                    motorista_id: driverId,
                    motorista_nome: ev.driver_name || (ev.drivers as any)?.name || '-',
                    placa: (ev.drivers as any)?.license_plate || '-',
                    total: 0, entregues: 0, insucessos: 0, em_rota: 0, sem_info: 0,
                    pendente: false
                }
                detalhes[driverId] = { entregues: [], insucessos: [], em_rota: [], sem_info: [] }
            }

            agrupado[driverId].total++

            if (entreguesNoDia.has(pkgId)) {
                agrupado[driverId].entregues++
                detalhes[driverId].entregues.push(barcode)
            } else if (insucessosNoDia.has(pkgId)) {
                agrupado[driverId].insucessos++
                detalhes[driverId].insucessos.push(barcode)
                agrupado[driverId].pendente = true
            } else {
                agrupado[driverId].em_rota++
                detalhes[driverId].em_rota.push(barcode)
            }
        }

        setMotoristas(Object.values(agrupado))
        setDetalhesPacotes(detalhes)
        setLoading(false)
    }, [supabase])

    useEffect(() => {
        async function init() {
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) { router.push('/login'); return }
            const { data: userData } = await supabase
                .from('users').select('company_id, name').eq('id', user.id).single()
            if (!userData) return
            setOperatorName(userData.name)

            const savedBase = typeof window !== 'undefined' ? localStorage.getItem('wms_base_selecionada') : null
            const cid = savedBase || userData.company_id
            setCompanyId(cid)

            // Roda auto-escalonamento antes de carregar
            await autoEscalarDispatchados(cid, userData.name)
            await carregarMotoristas(cid, hojeFormatado())
        }
        init()
    }, [])

    function handleDataChange(e: React.ChangeEvent<HTMLInputElement>) {
        setDataSelecionada(e.target.value)
        if (companyId) carregarMotoristas(companyId, e.target.value)
    }

    function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0]
        if (!file) return
        setArquivoNome(file.name)

        const reader = new FileReader()
        reader.onload = (evt) => {
            const text = evt.target?.result as string
            const linhas = text.split('\n')
            if (linhas.length < 2) return

            const header = linhas[0]
            const separador = header.includes(';') ? ';' : ','
            const mapa: Record<string, { status: string; reason: string; time: string }> = {}

            for (const linha of linhas.slice(1)) {
                if (!linha.trim()) continue
                let cols: string[]
                if (separador === ',') {
                    cols = linha.replace(/^"|"$/g, '').split('","')
                } else {
                    cols = linha.split(';')
                }
                if (cols.length < 4) continue
                const trackingId = cols[0]?.trim().replace(/^"|"$/, '')
                const time = cols[1]?.trim().replace(/^"|"$/, '')
                const state = cols[3]?.trim().replace(/^"|"$/, '')
                const reason = cols[5]?.trim().replace(/^"|"$/, '') || ''
                if (!trackingId || !state || trackingId === 'Tracking ID') continue
                if (!mapa[trackingId] || time > mapa[trackingId].time) {
                    mapa[trackingId] = { status: state, reason, time }
                }
            }

            const resultado: Record<string, { status: string; reason: string }> = {}
            for (const [id, val] of Object.entries(mapa)) {
                resultado[id] = { status: val.status, reason: val.reason }
            }
            setArquivoDados(resultado)
            setArquivoCarregado(true)
        }
        reader.readAsText(file, 'utf-8')
    }

    async function processar() {
        if (Object.keys(arquivoDados).length === 0) return
        setProcessando(true)

        const inicio = toISOStart(dataSelecionada)
        const fim = toISOEnd(dataSelecionada)
        // Usa meio-dia do dia selecionado como timestamp dos eventos — garante que fiquem no range do dia
        const [ano, mes, dia] = dataSelecionada.split('-').map(Number)
        const createdAtDia = new Date(Date.UTC(ano, mes - 1, dia, 15, 0, 0)).toISOString() // meio-dia Brasília

        // Busca todos os eventos do dia sem limite de 1000
        let eventosProc: any[] = []
        let fromProc = 0
        while (true) {
            const { data: batch } = await supabase
                .from('package_events')
                .select(`driver_id, driver_name, packages(id, barcode, status, tentativas), drivers(name, license_plate)`)
                .eq('company_id', companyId)
                .eq('event_type', 'dispatched')
                .gte('created_at', inicio)
                .lte('created_at', fim)
                .range(fromProc, fromProc + 999)
            if (!batch || batch.length === 0) break
            eventosProc = [...eventosProc, ...batch]
            if (batch.length < 1000) break
            fromProc += 1000
        }
        const eventos = eventosProc
        if (!eventos || eventos.length === 0) { setProcessando(false); return }

        for (const ev of eventos) {
            const driverId = ev.driver_id
            const barcode = (ev.packages as any)?.barcode
            const pkgId = (ev.packages as any)?.id
            const pkgStatus = (ev.packages as any)?.status
            const tentativas = (ev.packages as any)?.tentativas || 0
            if (!barcode || !pkgId) continue

            const dadosCortex = arquivoDados[barcode]
            if (!dadosCortex) continue

            const statusCortex = dadosCortex.status
            const reasonCortex = dadosCortex.reason || ''

            // Coluna D: Delivered → entregue
            if (STATUS_ENTREGUE.includes(statusCortex)) {
                if (pkgStatus !== 'delivered') {
                    await supabase.from('packages').update({ status: 'delivered' }).eq('id', pkgId)
                    await supabase.from('package_events').insert({
                        package_id: pkgId, company_id: companyId,
                        event_type: 'delivered', outcome: 'delivered',
                        driver_id: driverId, driver_name: ev.driver_name,
                        created_at: createdAtDia
                    })
                }
                // Coluna D: Delivery Failed → insucesso
            } else if (STATUS_INSUCESSO.some(s => statusCortex.toLowerCase().includes(s.toLowerCase()))) {
                if (pkgStatus !== 'unsuccessful') {
                    await supabase.from('packages').update({ status: 'unsuccessful', tentativas: tentativas + 1 }).eq('id', pkgId)
                    await supabase.from('package_events').insert({
                        package_id: pkgId, company_id: companyId,
                        event_type: 'unsuccessful', outcome: 'unsuccessful',
                        outcome_notes: reasonCortex || null,
                        driver_id: driverId, driver_name: ev.driver_name,
                        created_at: createdAtDia
                    })
                }
                // Coluna F: Marked For Reprocess → avaria (abre incidente se não tiver)
            } else if (STATUS_AVARIA.some(s => reasonCortex.toLowerCase().includes(s.toLowerCase()))) {
                if (pkgStatus !== 'incident') {
                    await supabase.from('packages').update({ status: 'incident' }).eq('id', pkgId)
                    await supabase.from('package_events').insert({
                        package_id: pkgId, company_id: companyId,
                        event_type: 'incident',
                        driver_id: driverId, driver_name: ev.driver_name,
                        outcome_notes: `Avaria identificada pelo Cortex: ${reasonCortex}`,
                        created_at: createdAtDia
                    })
                    await supabase.from('incidents').insert({
                        company_id: companyId, package_id: pkgId, barcode,
                        type: 'avaria',
                        description: `Cortex: ${reasonCortex}`,
                        operator_name: operatorName || 'Sistema',
                        status: 'aberto'
                    })
                }
            }
        }

        await carregarMotoristas(companyId, dataSelecionada)
        setProcessando(false)
        setArquivoCarregado(false)
        setArquivoNome('')
        setArquivoDados({})
    }

    function progresso(m: MotoristaStatus) {
        if (m.total === 0) return 0
        return Math.round((m.entregues / m.total) * 100)
    }

    if (motoristaSelecionado) {
        const det = detalhesPacotes[motoristaSelecionado.motorista_id]
        const prog = progresso(motoristaSelecionado)

        return (
            <main className="min-h-screen p-6" style={{ backgroundColor: '#0f1923' }}>
                <div className="max-w-2xl mx-auto">
                    <button onClick={() => setMotoristaSelecionado(null)} className="text-slate-400 text-sm mb-6 hover:text-white">← Voltar</button>

                    <div className="flex items-start justify-between mb-6">
                        <div>
                            <h1 className="text-white font-black text-xl">{motoristaSelecionado.motorista_nome}</h1>
                            <p className="text-slate-400 text-xs mt-1">{motoristaSelecionado.placa} · {motoristaSelecionado.total} pacotes</p>
                        </div>
                        {motoristaSelecionado.pendente && (
                            <span className="px-3 py-1 rounded text-xs font-bold"
                                style={{ backgroundColor: '#2b0d0d', color: '#ff5252', border: '1px solid #ff5252' }}>
                                ⚠️ PENDÊNCIA
                            </span>
                        )}
                    </div>

                    <div className="grid grid-cols-4 gap-3 mb-6">
                        <div className="rounded-lg p-3 text-center" style={{ backgroundColor: '#0d2b1a', border: '1px solid #00e676' }}>
                            <p className="text-2xl font-black" style={{ color: '#00e676' }}>{motoristaSelecionado.entregues}</p>
                            <p className="text-xs font-bold tracking-widest uppercase mt-1" style={{ color: '#00e676' }}>Entregues</p>
                        </div>
                        <div className="rounded-lg p-3 text-center" style={{ backgroundColor: '#2b0d0d', border: '1px solid #ff5252' }}>
                            <p className="text-2xl font-black" style={{ color: '#ff5252' }}>{motoristaSelecionado.insucessos}</p>
                            <p className="text-xs font-bold tracking-widest uppercase mt-1" style={{ color: '#ff5252' }}>Insucessos</p>
                        </div>
                        <div className="rounded-lg p-3 text-center" style={{ backgroundColor: '#1a2736', border: '1px solid #00b4b4' }}>
                            <p className="text-2xl font-black" style={{ color: '#00b4b4' }}>{motoristaSelecionado.em_rota}</p>
                            <p className="text-xs font-bold tracking-widest uppercase mt-1" style={{ color: '#00b4b4' }}>Em Rota</p>
                        </div>
                        <div className="rounded-lg p-3 text-center" style={{ backgroundColor: '#1a2736', border: '1px solid #2a3f52' }}>
                            <p className="text-2xl font-black text-white">{motoristaSelecionado.total}</p>
                            <p className="text-xs font-bold tracking-widest uppercase mt-1 text-slate-400">Total</p>
                        </div>
                    </div>

                    <div className="rounded-lg p-4 mb-6" style={{ backgroundColor: '#1a2736' }}>
                        <div className="flex justify-between text-xs mb-2">
                            <span className="text-slate-400">{prog}% concluído</span>
                            <span className="text-slate-400">{motoristaSelecionado.entregues + motoristaSelecionado.insucessos} de {motoristaSelecionado.total}</span>
                        </div>
                        <div className="w-full rounded-full h-3" style={{ backgroundColor: '#0f1923' }}>
                            <div className="h-3 rounded-full transition-all"
                                style={{ width: `${prog}%`, backgroundColor: motoristaSelecionado.insucessos > 0 ? '#ffb300' : '#00e676' }} />
                        </div>
                    </div>

                    {det?.insucessos.length > 0 && (
                        <div className="rounded-lg p-5 mb-4" style={{ backgroundColor: '#1a2736' }}>
                            <p className="text-xs font-bold tracking-widest uppercase mb-3" style={{ color: '#ff5252' }}>
                                ❌ Insucessos — precisam voltar pra base ({det.insucessos.length})
                            </p>
                            <div className="flex flex-col gap-1">
                                {det.insucessos.map(b => (
                                    <p key={b} className="text-sm font-mono px-3 py-2 rounded"
                                        style={{ backgroundColor: '#2b0d0d', color: '#ff5252' }}>{b}</p>
                                ))}
                            </div>
                        </div>
                    )}

                    {det?.em_rota.length > 0 && (
                        <div className="rounded-lg p-5 mb-4" style={{ backgroundColor: '#1a2736' }}>
                            <p className="text-xs font-bold tracking-widest uppercase mb-3" style={{ color: '#00b4b4' }}>
                                🚚 Em Rota ({det.em_rota.length})
                            </p>
                            <div className="flex flex-col gap-1">
                                {det.em_rota.map(b => (
                                    <p key={b} className="text-sm font-mono px-3 py-2 rounded"
                                        style={{ backgroundColor: '#0f1923', color: '#00b4b4' }}>{b}</p>
                                ))}
                            </div>
                        </div>
                    )}

                    {det?.entregues.length > 0 && (
                        <div className="rounded-lg p-5 mb-4" style={{ backgroundColor: '#1a2736' }}>
                            <p className="text-xs font-bold tracking-widest uppercase mb-3" style={{ color: '#00e676' }}>
                                ✅ Entregues ({det.entregues.length})
                            </p>
                            <div className="flex flex-col gap-1 max-h-64 overflow-y-auto">
                                {det.entregues.map(b => (
                                    <p key={b} className="text-sm font-mono px-3 py-2 rounded"
                                        style={{ backgroundColor: '#0d2b1a', color: '#00e676' }}>{b}</p>
                                ))}
                            </div>
                        </div>
                    )}

                    {det?.sem_info.length > 0 && (
                        <div className="rounded-lg p-5" style={{ backgroundColor: '#1a2736' }}>
                            <p className="text-xs font-bold tracking-widest uppercase mb-3 text-slate-400">
                                ⚪ Sem Informação ({det.sem_info.length})
                            </p>
                            <div className="flex flex-col gap-1 max-h-32 overflow-y-auto">
                                {det.sem_info.map(b => (
                                    <p key={b} className="text-sm font-mono px-3 py-2 rounded text-slate-400"
                                        style={{ backgroundColor: '#0f1923' }}>{b}</p>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </main>
        )
    }

    return (
        <main className="min-h-screen p-6" style={{ backgroundColor: '#0f1923' }}>
            <div className="max-w-3xl mx-auto">
                <button onClick={() => router.push('/dashboard')} className="text-slate-400 text-sm mb-6 hover:text-white">← Voltar</button>

                <div className="flex items-center justify-between mb-4">
                    <div>
                        <h1 className="text-white font-black tracking-widest uppercase text-xl">🛣️ Monitoramento de Rua</h1>
                        <p className="text-slate-400 text-xs mt-1">
                            {new Date(dataSelecionada + 'T12:00:00').toLocaleDateString('pt-BR', {
                                timeZone: 'America/Sao_Paulo', weekday: 'long', day: '2-digit', month: 'long'
                            })}
                        </p>
                    </div>
                    <div className="flex items-center gap-3">
                        {arquivoCarregado && (
                            <button onClick={processar} disabled={processando}
                                className="px-4 py-2 rounded font-black tracking-widest uppercase text-xs disabled:opacity-50"
                                style={{ backgroundColor: '#00e676', color: '#0f1923' }}>
                                {processando ? 'Processando...' : `Processar (${Object.keys(arquivoDados).length})`}
                            </button>
                        )}
                        <label className="px-4 py-2 rounded font-black tracking-widest uppercase text-xs cursor-pointer"
                            style={{ backgroundColor: '#00b4b4', color: 'white' }}>
                            {arquivoNome ? `📁 ${arquivoNome.substring(0, 12)}...` : '📁 Arquivo Cortex'}
                            <input type="file" accept=".csv" onChange={handleUpload} className="hidden" />
                        </label>
                    </div>
                </div>

                <div className="flex items-center gap-3 mb-6">
                    <div className="flex items-center gap-3 px-4 py-2 rounded-lg" style={{ backgroundColor: '#1a2736' }}>
                        <span className="text-xs font-bold tracking-widest uppercase text-slate-400">Data</span>
                        <input type="date" value={dataSelecionada} onChange={handleDataChange}
                            max={hojeFormatado()} className="text-white text-sm outline-none"
                            style={{ backgroundColor: 'transparent', colorScheme: 'dark' }} />
                    </div>
                    {!isHoje && (
                        <button onClick={() => {
                            const hoje = hojeFormatado()
                            setDataSelecionada(hoje)
                            if (companyId) carregarMotoristas(companyId, hoje)
                        }} className="px-3 py-2 rounded text-xs font-bold tracking-widest uppercase"
                            style={{ backgroundColor: '#00b4b4', color: 'white' }}>
                            Hoje
                        </button>
                    )}
                </div>

                {motoristas.length > 0 && (
                    <div className="grid grid-cols-4 gap-3 mb-6">
                        <div className="rounded-lg p-3 text-center" style={{ backgroundColor: '#0d2b1a', border: '1px solid #00e676' }}>
                            <p className="text-2xl font-black" style={{ color: '#00e676' }}>{motoristas.reduce((a, m) => a + m.entregues, 0)}</p>
                            <p className="text-xs font-bold tracking-widest uppercase mt-1" style={{ color: '#00e676' }}>Entregues</p>
                        </div>
                        <div className="rounded-lg p-3 text-center" style={{ backgroundColor: '#2b0d0d', border: '1px solid #ff5252' }}>
                            <p className="text-2xl font-black" style={{ color: '#ff5252' }}>{motoristas.reduce((a, m) => a + m.insucessos, 0)}</p>
                            <p className="text-xs font-bold tracking-widest uppercase mt-1" style={{ color: '#ff5252' }}>Insucessos</p>
                        </div>
                        <div className="rounded-lg p-3 text-center" style={{ backgroundColor: '#1a2736', border: '1px solid #00b4b4' }}>
                            <p className="text-2xl font-black" style={{ color: '#00b4b4' }}>{motoristas.reduce((a, m) => a + m.em_rota, 0)}</p>
                            <p className="text-xs font-bold tracking-widest uppercase mt-1" style={{ color: '#00b4b4' }}>Em Rota</p>
                        </div>
                        <div className="rounded-lg p-3 text-center" style={{ backgroundColor: '#1a2736', border: '1px solid #2a3f52' }}>
                            <p className="text-2xl font-black text-slate-400">{motoristas.reduce((a, m) => a + m.total, 0)}</p>
                            <p className="text-xs font-bold tracking-widest uppercase mt-1 text-slate-500">Total</p>
                        </div>
                    </div>
                )}

                {loading ? (
                    <p className="text-slate-400 text-sm">Carregando...</p>
                ) : motoristas.length === 0 ? (
                    <div className="rounded-lg p-8 text-center" style={{ backgroundColor: '#1a2736' }}>
                        <p className="text-slate-400">
                            Nenhum motorista com saída do pátio registrada em{' '}
                            {new Date(dataSelecionada + 'T12:00:00').toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}.
                        </p>
                    </div>
                ) : (
                    <div className="flex flex-col gap-3">
                        {motoristas.map(m => (
                            <button key={m.motorista_id}
                                onClick={() => setMotoristaSelecionado(m)}
                                className="rounded-lg p-4 text-left outline-none hover:opacity-90 transition-opacity"
                                style={{ backgroundColor: '#1a2736', border: m.pendente ? '1px solid #ff5252' : '1px solid #1a2736' }}>
                                <div className="flex items-center justify-between mb-3">
                                    <div>
                                        <div className="flex items-center gap-2">
                                            <p className="text-white font-bold">{m.motorista_nome}</p>
                                            {m.pendente && (
                                                <span className="px-2 py-0.5 rounded text-xs font-bold"
                                                    style={{ backgroundColor: '#2b0d0d', color: '#ff5252' }}>
                                                    ⚠️ PENDÊNCIA
                                                </span>
                                            )}
                                        </div>
                                        <p className="text-slate-400 text-xs">{m.placa} · {m.total} pacotes</p>
                                    </div>
                                    <div className="flex gap-3 text-sm font-bold">
                                        <span style={{ color: '#00e676' }}>✅ {m.entregues}</span>
                                        <span style={{ color: '#ff5252' }}>❌ {m.insucessos}</span>
                                        <span style={{ color: '#00b4b4' }}>🚚 {m.em_rota}</span>
                                        <span className="text-slate-500">⚪ {m.sem_info}</span>
                                    </div>
                                </div>
                                <div className="w-full rounded-full h-2" style={{ backgroundColor: '#0f1923' }}>
                                    <div className="h-2 rounded-full transition-all duration-500"
                                        style={{ width: `${progresso(m)}%`, backgroundColor: m.insucessos > 0 ? '#ffb300' : '#00e676' }} />
                                </div>
                                <div className="flex justify-between mt-1">
                                    <span className="text-xs text-slate-500">{progresso(m)}% concluído</span>
                                    <span className="text-xs text-slate-500">{m.entregues + m.insucessos} de {m.total}</span>
                                </div>
                            </button>
                        ))}
                    </div>
                )}
            </div>
        </main>
    )
}