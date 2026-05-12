'use client'

import { useState, useRef, useEffect } from 'react'
import { createClient } from '../lib/supabase'
import { useRouter } from 'next/navigation'
import * as XLSX from 'xlsx'
import { somSucesso, somErro, somAlerta } from '../lib/sounds'

type Motorista = {
    id: string
    name: string
    cpf: string | null
    license_plate: string
    vehicle_type: string
}

type ExpedicaoAtiva = {
    motorista_id: string
    motorista_nome: string
    placa: string
    total: number
    jaPartiu: boolean
}

type PacoteBipado = {
    id: string
    barcode: string
    client_name: string
    status: 'ok' | 'erro'
    msg: string
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

export default function ExpedicaoPage() {
    const router = useRouter()
    const supabase = createClient()
    const inputRef = useRef<HTMLInputElement>(null)

    const [companyId, setCompanyId] = useState('')
    const [baseId, setBaseId] = useState('')
    const [operatorId, setOperatorId] = useState('')
    const [operatorName, setOperatorName] = useState('')

    const [motoristas, setMotoristas] = useState<Motorista[]>([])
    const [expedicoesHoje, setExpedicoesHoje] = useState<ExpedicaoAtiva[]>([])
    const [motoristaId, setMotoristaId] = useState('')
    const [buscaMotorista, setBuscaMotorista] = useState('')
    const [mostrarLista, setMostrarLista] = useState(false)

    const [fase, setFase] = useState<'setup' | 'bipando' | 'resultado'>('setup')
    const [barcode, setBarcode] = useState('')
    const [bipados, setBipados] = useState<PacoteBipado[]>([])
    const [feedback, setFeedback] = useState<{ msg: string; tipo: 'ok' | 'erro' } | null>(null)
    const [salvando, setSalvando] = useState(false)
    const [erroMsg, setErroMsg] = useState('')

    const [dataExport, setDataExport] = useState(hojeFormatado())
    const [dataSelecionada, setDataSelecionada] = useState(hojeFormatado())
    const [exportando, setExportando] = useState(false)

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

            const savedBase = typeof window !== 'undefined'
                ? localStorage.getItem('wms_base_selecionada')
                : null
            const cid = savedBase || userData.company_id
            setBaseId(cid)

            await carregarMotoristas(cid)
            await carregarExpedicoesHoje(cid, hojeFormatado())
        }
        init()
    }, [])

    async function carregarMotoristas(cid: string) {
        const { data } = await supabase
            .from('drivers').select('*')
            .eq('company_id', cid)
            .eq('active', true).eq('status', 'active').order('name')
        setMotoristas(data || [])
    }

    async function carregarExpedicoesHoje(cid: string, dia: string) {
        const inicio = toISOStart(dia)
        const fim = toISOEnd(dia)

        let allData: any[] = []
        let from = 0
        const BATCH = 1000
        while (true) {
            const { data: batch } = await supabase
                .from('package_events')
                .select('driver_id, driver_name')
                .eq('company_id', cid)
                .eq('event_type', 'dispatched')
                .gte('created_at', inicio)
                .lte('created_at', fim)
                .range(from, from + BATCH - 1)
            if (!batch || batch.length === 0) break
            allData = [...allData, ...batch]
            if (batch.length < BATCH) break
            from += BATCH
        }

        if (allData.length === 0) {
            setExpedicoesHoje([])
            return
        }

        // Busca saídas do pátio SEM filtro de data — resolve virada de dia
        // Um motorista que entrou ontem e saiu hoje deve aparecer como "Em rota"
        const { data: visitas } = await supabase
            .from('vehicle_visits')
            .select('driver_id')
            .eq('company_id', cid)
            .not('departed_at', 'is', null)

        const jaPartiuSet = new Set((visitas || []).map((v: any) => v.driver_id))

        const agrupado: Record<string, ExpedicaoAtiva> = {}
        for (const ev of allData) {
            if (!ev.driver_id) continue
            if (!agrupado[ev.driver_id]) {
                agrupado[ev.driver_id] = {
                    motorista_id: ev.driver_id,
                    motorista_nome: ev.driver_name || '-',
                    placa: '-',
                    total: 0,
                    jaPartiu: jaPartiuSet.has(ev.driver_id)
                }
            }
            agrupado[ev.driver_id].total++
        }
        setExpedicoesHoje(Object.values(agrupado))
    }

    async function exportarExpedicao() {
        setExportando(true)
        const inicio = toISOStart(dataExport)
        const fim = toISOEnd(dataExport)

        // Busca todos sem limite de 1000
        let eventosAll: any[] = []
        let from = 0
        while (true) {
            const { data: batch } = await supabase
                .from('package_events')
                .select(`created_at, operator_name, driver_name, packages(barcode, clients(name)), drivers(license_plate)`)
                .eq('company_id', baseId).eq('event_type', 'dispatched')
                .gte('created_at', inicio).lte('created_at', fim)
                .order('created_at', { ascending: true })
                .range(from, from + 999)
            if (!batch || batch.length === 0) break
            eventosAll = [...eventosAll, ...batch]
            if (batch.length < 1000) break
            from += 1000
        }

        if (eventosAll.length === 0) {
            alert('Nenhuma expedição encontrada nessa data.')
            setExportando(false)
            return
        }

        const rows = eventosAll.map((ev: any) => ({
            'Código (SKU)': ev.packages?.barcode || '-',
            'Cliente': ev.packages?.clients?.name || '-',
            'Motorista': ev.driver_name || '-',
            'Placa': ev.drivers?.license_plate || '-',
            'Data/Hora Saída': new Date(ev.created_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
            'Expedidor': ev.operator_name || '-',
        }))

        const wb = XLSX.utils.book_new()
        const ws = XLSX.utils.json_to_sheet(rows)
        ws['!cols'] = [{ wch: 20 }, { wch: 15 }, { wch: 25 }, { wch: 12 }, { wch: 20 }, { wch: 20 }]
        XLSX.utils.book_append_sheet(wb, ws, 'Expedição')
        XLSX.writeFile(wb, `expedicao_${dataExport}.xlsx`)
        setExportando(false)
    }

    async function verificarPendencias(driverId: string): Promise<{ unsuccessful: number; emRota: number }> {
        let evInsucessoAll: any[] = []
        let from = 0
        while (true) {
            const { data: batch } = await supabase
                .from('package_events').select('package_id')
                .eq('driver_id', driverId).eq('event_type', 'unsuccessful')
                .range(from, from + 999)
            if (!batch || batch.length === 0) break
            evInsucessoAll = [...evInsucessoAll, ...batch]
            if (batch.length < 1000) break
            from += 1000
        }

        let unsuccessful = 0
        if (evInsucessoAll.length > 0) {
            const ids = evInsucessoAll.map((e: any) => e.package_id)
            const { data: pkgs } = await supabase.from('packages').select('id')
                .eq('status', 'unsuccessful').in('id', ids)
            unsuccessful = pkgs?.length || 0
        }

        let evDispatchedAll: any[] = []
        let from2 = 0
        while (true) {
            const { data: batch } = await supabase
                .from('package_events').select('package_id')
                .eq('driver_id', driverId).eq('event_type', 'dispatched')
                .range(from2, from2 + 999)
            if (!batch || batch.length === 0) break
            evDispatchedAll = [...evDispatchedAll, ...batch]
            if (batch.length < 1000) break
            from2 += 1000
        }

        let emRota = 0
        if (evDispatchedAll.length > 0) {
            const ids = [...new Set(evDispatchedAll.map((e: any) => e.package_id))]
            const { data: pkgs } = await supabase.from('packages').select('id')
                .eq('status', 'dispatched').in('id', ids)
            emRota = pkgs?.length || 0
        }

        return { unsuccessful, emRota }
    }

    async function verificarPatio(driverId: string): Promise<boolean> {
        const { data } = await supabase
            .from('vehicle_visits').select('id')
            .eq('driver_id', driverId).eq('company_id', baseId)
            .is('departed_at', null).limit(1)
        return (data?.length ?? 0) > 0
    }

    async function iniciarExpedicao() {
        if (!motoristaId) { setErroMsg('Selecione um motorista'); return }
        setErroMsg('')
        setSalvando(true)

        const { unsuccessful, emRota } = await verificarPendencias(motoristaId)

        if (unsuccessful > 0) {
            somErro()
            setErroMsg(`⚠️ Este motorista tem ${unsuccessful} pacote(s) com insucesso pendente. Devolva os pacotes antes de carregar novamente.`)
            setSalvando(false)
            return
        }

        if (emRota > 0) {
            somErro()
            setErroMsg(`🚚 Este motorista tem ${emRota} pacote(s) ainda em rota. Processe o retorno antes de carregar novamente.`)
            setSalvando(false)
            return
        }

        const noPateo = await verificarPatio(motoristaId)
        if (!noPateo) {
            somErro()
            setErroMsg('🅿️ Motorista não tem entrada registrada no Pátio. Registre a chegada antes de carregar.')
            setSalvando(false)
            return
        }

        setSalvando(false)
        setBipados([])
        setFase('bipando')
        setTimeout(() => inputRef.current?.focus(), 100)
    }

    function continuarExpedicao(exp: ExpedicaoAtiva) {
        setMotoristaId(exp.motorista_id)
        setBipados([])
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
            setFeedback({ msg: `⚠️ ${codigo} já foi bipado`, tipo: 'erro' })
            setTimeout(() => setFeedback(null), 2000)
            inputRef.current?.focus()
            return
        }

        const { data: pkg } = await supabase
            .from('packages').select('id, status, clients(name)')
            .eq('barcode', codigo).eq('company_id', baseId).single()

        if (!pkg) {
            somErro()
            setBipados(prev => [...prev, { id: '', barcode: codigo, client_name: '-', status: 'erro', msg: 'Pacote não encontrado' }])
            setFeedback({ msg: `❌ ${codigo} — não encontrado`, tipo: 'erro' })
            setTimeout(() => setFeedback(null), 2000)
            inputRef.current?.focus()
            return
        }

        if (pkg.status !== 'in_warehouse') {
            somErro()
            setBipados(prev => [...prev, { id: pkg.id, barcode: codigo, client_name: (pkg.clients as any)?.name || '-', status: 'erro', msg: 'Não está no armazém' }])
            setFeedback({ msg: `❌ ${codigo} — não está no armazém`, tipo: 'erro' })
            setTimeout(() => setFeedback(null), 2000)
            inputRef.current?.focus()
            return
        }

        somSucesso()
        setBipados(prev => [...prev, { id: pkg.id, barcode: codigo, client_name: (pkg.clients as any)?.name || '-', status: 'ok', msg: 'Pronto para expedir' }])
        setFeedback({ msg: `✅ ${codigo}`, tipo: 'ok' })
        setTimeout(() => setFeedback(null), 1500)
        inputRef.current?.focus()
    }

    async function finalizarExpedicao() {
        const validos = bipados.filter(b => b.status === 'ok')
        if (validos.length === 0) { setErroMsg('Nenhum pacote válido para expedir'); return }
        setSalvando(true)
        setErroMsg('')

        const motorista = motoristas.find(m => m.id === motoristaId)
        for (const pkg of validos) {
            await supabase.from('packages').update({ status: 'dispatched' }).eq('id', pkg.id)
            await supabase.from('package_events').insert({
                package_id: pkg.id, company_id: baseId,
                event_type: 'dispatched', operator_id: operatorId,
                operator_name: operatorName, driver_id: motoristaId,
                driver_name: motorista?.name,
            })
        }

        setSalvando(false)
        setFase('resultado')
    }

    const motoristaSelecionado = motoristas.find(m => m.id === motoristaId)
    const isHoje = dataSelecionada === hojeFormatado()

    if (fase === 'setup') return (
        <main className="min-h-screen p-6" style={{ backgroundColor: '#0f1923' }}>
            <div className="max-w-lg mx-auto">
                <button onClick={() => router.push('/dashboard')} className="text-slate-400 text-sm mb-6 hover:text-white">← Voltar</button>
                <h1 className="text-white font-black tracking-widest uppercase text-xl mb-6">🚚 Expedição</h1>

                <div className="rounded-lg p-5 mb-6" style={{ backgroundColor: '#1a2736' }}>
                    <p className="text-xs font-bold tracking-widest uppercase text-slate-400 mb-3">Exportar Expedição</p>
                    <div className="flex items-center gap-3">
                        <div className="flex items-center gap-2 px-4 py-2 rounded flex-1"
                            style={{ backgroundColor: '#0f1923', border: '1px solid #2a3f52' }}>
                            <span className="text-xs text-slate-400">Data</span>
                            <input type="date" value={dataExport}
                                onChange={e => {
                                    setDataExport(e.target.value)
                                    setDataSelecionada(e.target.value)
                                    if (baseId) carregarExpedicoesHoje(baseId, e.target.value)
                                }}
                                max={hojeFormatado()} className="text-white text-sm outline-none flex-1"
                                style={{ backgroundColor: 'transparent', colorScheme: 'dark' }} />
                        </div>
                        <button onClick={exportarExpedicao} disabled={exportando}
                            className="px-4 py-2 rounded font-black tracking-widest uppercase text-sm disabled:opacity-50"
                            style={{ backgroundColor: '#00b4b4', color: 'white' }}>
                            {exportando ? '...' : '⬇️ Excel'}
                        </button>
                    </div>
                </div>

                <div className="rounded-lg p-6 flex flex-col gap-5 mb-6" style={{ backgroundColor: '#1a2736' }}>
                    <p className="text-xs font-bold tracking-widest uppercase text-slate-400">Nova Expedição</p>
                    <div className="flex flex-col gap-2">
                        <label className="text-xs font-bold tracking-widest uppercase text-slate-400">Selecione o Motorista</label>
                        <div className="relative">
                            <input
                                type="text"
                                value={buscaMotorista}
                                onChange={e => { setBuscaMotorista(e.target.value); setMotoristaId(''); setMostrarLista(true) }}
                                onFocus={() => setMostrarLista(true)}
                                placeholder="Digite o nome ou placa..."
                                className="w-full px-4 py-3 rounded text-white text-sm outline-none"
                                style={{ backgroundColor: '#0f1923', border: `1px solid ${motoristaId ? '#00b4b4' : '#2a3f52'}` }}
                            />
                            {motoristaId && (
                                <button onClick={() => { setMotoristaId(''); setBuscaMotorista(''); setMostrarLista(true) }}
                                    className="absolute right-3 top-3 text-slate-400 hover:text-white text-xs">✕</button>
                            )}
                            {mostrarLista && buscaMotorista && !motoristaId && (() => {
                                const filtrados = motoristas.filter(m =>
                                    m.name.toLowerCase().includes(buscaMotorista.toLowerCase()) ||
                                    m.license_plate.toLowerCase().includes(buscaMotorista.toLowerCase())
                                )
                                return filtrados.length > 0 ? (
                                    <div className="absolute z-10 w-full mt-1 rounded-lg overflow-hidden shadow-lg"
                                        style={{ backgroundColor: '#1a2736', border: '1px solid #2a3f52', maxHeight: '240px', overflowY: 'auto' }}>
                                        {filtrados.map(m => (
                                            <button key={m.id}
                                                onClick={() => { setMotoristaId(m.id); setBuscaMotorista(`${m.name} — ${m.license_plate}`); setMostrarLista(false) }}
                                                className="w-full px-4 py-3 text-left hover:opacity-80 outline-none border-b"
                                                style={{ backgroundColor: '#1a2736', borderColor: '#0f1923' }}>
                                                <p className="text-white text-sm font-bold">{m.name}</p>
                                                <p className="text-slate-400 text-xs">{m.license_plate} · {m.vehicle_type}</p>
                                            </button>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="absolute z-10 w-full mt-1 rounded-lg px-4 py-3"
                                        style={{ backgroundColor: '#1a2736', border: '1px solid #2a3f52' }}>
                                        <p className="text-slate-400 text-sm">Nenhum motorista encontrado</p>
                                    </div>
                                )
                            })()}
                        </div>
                        {motoristaId && (
                            <p className="text-xs font-bold" style={{ color: '#00b4b4' }}>✅ Motorista selecionado</p>
                        )}
                        <p className="text-xs text-slate-500">
                            Motorista não aparece?{' '}
                            <button onClick={() => router.push('/motoristas')} className="underline" style={{ color: '#00b4b4' }}>
                                Cadastre em Motoristas
                            </button>
                        </p>
                    </div>
                    {erroMsg && (
                        <div className="rounded p-3 text-sm font-bold"
                            style={{ backgroundColor: '#2b0d0d', color: '#ff5252', border: '1px solid #ff5252' }}>
                            {erroMsg}
                        </div>
                    )}
                    <button onClick={iniciarExpedicao} disabled={salvando}
                        className="py-3 rounded font-black tracking-widest uppercase text-white text-sm disabled:opacity-50"
                        style={{ backgroundColor: '#00b4b4' }}>
                        {salvando ? 'Verificando...' : 'Iniciar Expedição'}
                    </button>
                </div>

                {expedicoesHoje.length > 0 && (
                    <div className="rounded-lg p-5" style={{ backgroundColor: '#1a2736' }}>
                        <p className="text-xs font-bold tracking-widest uppercase text-slate-400 mb-3">
                            {isHoje ? 'Expedições de Hoje' : `Expedições de ${new Date(dataSelecionada + 'T12:00:00').toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`}
                        </p>
                        <div className="flex flex-col gap-2 max-h-64 overflow-y-auto">
                            {expedicoesHoje.map(exp => (
                                <div key={exp.motorista_id} className="flex items-center justify-between p-3 rounded"
                                    style={{ backgroundColor: '#0f1923' }}>
                                    <div>
                                        <p className="text-white font-bold text-sm">{exp.motorista_nome}</p>
                                        <p className="text-slate-400 text-xs">
                                            {exp.total} pacotes
                                            {exp.jaPartiu
                                                ? <span className="ml-2 font-bold" style={{ color: '#00b4b4' }}> · 🚚 Em rota</span>
                                                : <span className="ml-2 font-bold" style={{ color: '#ffb300' }}> · 🅿️ No pátio</span>
                                            }
                                        </p>
                                    </div>
                                    {!exp.jaPartiu && isHoje && (
                                        <button onClick={() => continuarExpedicao(exp)}
                                            className="px-3 py-2 rounded text-xs font-bold tracking-widest uppercase"
                                            style={{ backgroundColor: '#00b4b4', color: 'white' }}>
                                            Continuar
                                        </button>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </main>
    )

    if (fase === 'bipando') return (
        <main className="min-h-screen p-6" style={{ backgroundColor: '#0f1923' }}>
            <div className="max-w-2xl mx-auto">
                <button onClick={() => setFase('setup')} className="text-slate-400 text-sm mb-6 hover:text-white">← Voltar</button>
                <h1 className="text-white font-black tracking-widest uppercase text-xl mb-2">🚚 Expedindo Pacotes</h1>
                <p className="text-slate-400 text-sm mb-6">{motoristaSelecionado?.name} — {motoristaSelecionado?.license_plate}</p>

                <div className="rounded-lg p-4 mb-4" style={{ backgroundColor: '#1a2736' }}>
                    <input ref={inputRef} type="text" value={barcode}
                        onChange={e => setBarcode(e.target.value)} onKeyDown={handleBipe}
                        placeholder="Bipe ou digite o código e pressione Enter"
                        className="w-full px-4 py-4 rounded text-white text-lg outline-none"
                        style={{ backgroundColor: '#0f1923', border: '2px solid #00b4b4' }} autoFocus />
                </div>

                {feedback && (
                    <div className="rounded p-3 mb-4 text-sm font-bold tracking-wide"
                        style={{
                            backgroundColor: feedback.tipo === 'ok' ? '#0d2b1a' : '#2b0d0d',
                            color: feedback.tipo === 'ok' ? '#00e676' : '#ff5252',
                            border: `1px solid ${feedback.tipo === 'ok' ? '#00e676' : '#ff5252'}`
                        }}>
                        {feedback.msg}
                    </div>
                )}

                <div className="rounded-lg p-4 mb-4 flex justify-between" style={{ backgroundColor: '#1a2736' }}>
                    <span className="text-slate-400 text-sm">Total: <span className="text-white font-bold">{bipados.length}</span></span>
                    <span className="text-sm">
                        <span style={{ color: '#00e676' }}>{bipados.filter(b => b.status === 'ok').length} ok</span>
                        {' · '}
                        <span style={{ color: '#ff5252' }}>{bipados.filter(b => b.status === 'erro').length} erro</span>
                    </span>
                </div>

                <div className="rounded-lg p-4 mb-4" style={{ backgroundColor: '#1a2736' }}>
                    <p className="text-xs font-bold tracking-widest uppercase text-slate-400 mb-3">Últimos bipados</p>
                    <div className="flex flex-col gap-2 max-h-48 overflow-y-auto">
                        {[...bipados].reverse().slice(0, 15).map((b, i) => (
                            <div key={i} className="flex items-center justify-between text-sm">
                                <div>
                                    <span className="text-white font-mono">{b.barcode}</span>
                                    <span className="text-slate-500 text-xs ml-2">{b.client_name}</span>
                                </div>
                                <span className="text-xs font-bold" style={{ color: b.status === 'ok' ? '#00e676' : '#ff5252' }}>
                                    {b.status === 'ok' ? '✅ OK' : `❌ ${b.msg}`}
                                </span>
                            </div>
                        ))}
                        {bipados.length === 0 && <p className="text-slate-500 text-sm">Nenhum pacote bipado ainda</p>}
                    </div>
                </div>

                {erroMsg && (
                    <div className="rounded p-3 mb-4 text-sm font-bold"
                        style={{ backgroundColor: '#2b0d0d', color: '#ff5252', border: '1px solid #ff5252' }}>
                        {erroMsg}
                    </div>
                )}

                <button onClick={finalizarExpedicao} disabled={salvando}
                    className="w-full py-3 rounded font-black tracking-widest uppercase text-white text-sm disabled:opacity-50"
                    style={{ backgroundColor: '#c0392b' }}>
                    {salvando ? 'Salvando...' : `Finalizar Expedição (${bipados.filter(b => b.status === 'ok').length} pacotes)`}
                </button>
            </div>
        </main>
    )

    return (
        <main className="min-h-screen p-6" style={{ backgroundColor: '#0f1923' }}>
            <div className="max-w-lg mx-auto">
                <h1 className="text-white font-black tracking-widest uppercase text-xl mb-6">✅ Expedição Finalizada</h1>
                <div className="rounded-lg p-6 flex flex-col gap-4" style={{ backgroundColor: '#1a2736' }}>
                    <div className="flex justify-between">
                        <span className="text-slate-400 text-sm">Motorista</span>
                        <span className="text-white font-bold text-sm">{motoristaSelecionado?.name}</span>
                    </div>
                    <div className="flex justify-between">
                        <span className="text-slate-400 text-sm">Placa</span>
                        <span className="text-white font-bold text-sm">{motoristaSelecionado?.license_plate}</span>
                    </div>
                    <div className="flex justify-between">
                        <span className="text-slate-400 text-sm">Pacotes expedidos</span>
                        <span className="font-black text-2xl" style={{ color: '#00e676' }}>{bipados.filter(b => b.status === 'ok').length}</span>
                    </div>
                    {bipados.filter(b => b.status === 'erro').length > 0 && (
                        <div className="flex justify-between">
                            <span className="text-slate-400 text-sm">Com erro</span>
                            <span className="font-black text-2xl" style={{ color: '#ff5252' }}>{bipados.filter(b => b.status === 'erro').length}</span>
                        </div>
                    )}
                </div>
                <div className="flex gap-3 mt-4">
                    <button onClick={() => { setBipados([]); setFase('bipando') }}
                        className="flex-1 py-3 rounded font-black tracking-widest uppercase text-white text-sm"
                        style={{ backgroundColor: '#1a2736', border: '1px solid #2a3f52' }}>
                        Continuar Bipando
                    </button>
                    <button onClick={() => router.push('/dashboard')}
                        className="flex-1 py-3 rounded font-black tracking-widest uppercase text-white text-sm"
                        style={{ backgroundColor: '#00b4b4' }}>
                        Dashboard
                    </button>
                </div>
            </div>
        </main>
    )
}