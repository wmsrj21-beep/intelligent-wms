'use client'

import { useState, useEffect } from 'react'
import { createClient } from '../lib/supabase'
import { useRouter } from 'next/navigation'

type Motorista = {
    id: string
    name: string
    license_plate: string
    vehicle_type: string
}

type Visita = {
    id: string
    direction: string
    arrived_at: string
    departed_at: string | null
    arrived_operator: string | null
    departed_operator: string | null
    notes: string | null
    drivers: { name: string; license_plate: string; vehicle_type: string }
    clients: { name: string } | null
}

type Cliente = { id: string; name: string }

const vehicleIcon: Record<string, string> = {
    passeio: '🚗', utilitario: '🚐', van: '🚌',
    truck: '🚛', carreta: '🚚', moto: '🏍️', outros: '🚘',
}

function hojeFormatado(): string {
    return new Date().toLocaleDateString('pt-BR', {
        timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit'
    }).split('/').reverse().join('-')
}
function toISOStart(data: string): string { return `${data}T03:00:00.000Z` }
function toISOEnd(data: string): string {
    const [ano, mes, dia] = data.split('-').map(Number)
    return new Date(Date.UTC(ano, mes - 1, dia + 1, 2, 59, 59, 999)).toISOString()
}
function formatTime(dt: string) {
    return new Date(dt).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' })
}
function tempoNoPatio(arrived_at: string) {
    const diff = Date.now() - new Date(arrived_at).getTime()
    const mins = Math.floor(diff / 60000)
    if (mins < 60) return `${mins}min`
    return `${Math.floor(mins / 60)}h${mins % 60 > 0 ? `${mins % 60}min` : ''}`
}
function tempoTotal(arrived: string, departed: string) {
    const diff = new Date(departed).getTime() - new Date(arrived).getTime()
    const mins = Math.floor(diff / 60000)
    if (mins < 60) return `${mins}min no pátio`
    return `${Math.floor(mins / 60)}h${mins % 60 > 0 ? `${mins % 60}min` : ''} no pátio`
}

export default function PatioPage() {
    const router = useRouter()
    const supabase = createClient()

    const [companyId, setCompanyId] = useState('')
    const [baseId, setBaseId] = useState('')
    const [operatorId, setOperatorId] = useState('')
    const [motoristas, setMotoristas] = useState<Motorista[]>([])
    const [clientes, setClientes] = useState<Cliente[]>([])
    const [visitasAtivas, setVisitasAtivas] = useState<Visita[]>([])
    const [historicoHoje, setHistoricoHoje] = useState<Visita[]>([])
    const [dataSelecionada, setDataSelecionada] = useState(hojeFormatado())

    const [modal, setModal] = useState<'entrada' | 'saida' | null>(null)
    const [visitaSaida, setVisitaSaida] = useState<string>('')
    const [motoristaId, setMotoristaId] = useState('')
    const [clienteId, setClienteId] = useState('')
    const [direction, setDirection] = useState<'inbound' | 'outbound'>('inbound')
    const [notes, setNotes] = useState('')
    const [salvando, setSalvando] = useState(false)
    const [erro, setErro] = useState('')

    const isHoje = dataSelecionada === hojeFormatado()

    useEffect(() => {
        async function init() {
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) { router.push('/login'); return }
            setOperatorId(user.id)

            const { data: userData } = await supabase
                .from('users').select('company_id').eq('id', user.id).single()
            if (!userData) return
            setCompanyId(userData.company_id)

            const savedBase = typeof window !== 'undefined' ? localStorage.getItem('wms_base_selecionada') : null
            const cid = savedBase || userData.company_id
            setBaseId(cid)

            const [motoristasRes, clientesRes] = await Promise.all([
                supabase.from('drivers').select('*').eq('company_id', cid).eq('active', true).order('name'),
                supabase.from('clients').select('*').eq('company_id', cid).eq('active', true)
            ])

            setMotoristas(motoristasRes.data || [])
            setClientes(clientesRes.data || [])
            await carregarVisitas(cid, hojeFormatado())
        }
        init()
    }, [])

    async function carregarVisitas(cid: string, data: string) {
        const inicio = toISOStart(data)
        const fim = toISOEnd(data)

        const [ativosRes, historicoRes] = await Promise.all([
            supabase
                .from('vehicle_visits')
                .select(`id, direction, arrived_at, departed_at, arrived_operator, departed_operator, notes,
                    drivers(name, license_plate, vehicle_type), clients(name)`)
                .eq('company_id', cid)
                .is('departed_at', null)
                .gte('arrived_at', inicio)
                .lte('arrived_at', fim)
                .order('arrived_at', { ascending: false }),
            supabase
                .from('vehicle_visits')
                .select(`id, direction, arrived_at, departed_at, arrived_operator, departed_operator, notes,
                    drivers(name, license_plate, vehicle_type), clients(name)`)
                .eq('company_id', cid)
                .not('departed_at', 'is', null)
                .gte('arrived_at', inicio)
                .lte('arrived_at', fim)
                .order('arrived_at', { ascending: false })
        ])

        setVisitasAtivas(ativosRes.data as any[] || [])
        setHistoricoHoje(historicoRes.data as any[] || [])
    }

    function handleDataChange(e: React.ChangeEvent<HTMLInputElement>) {
        setDataSelecionada(e.target.value)
        if (baseId) carregarVisitas(baseId, e.target.value)
    }

    async function registrarEntrada() {
        if (!motoristaId) { setErro('Selecione um motorista'); return }
        setSalvando(true); setErro('')

        await supabase.from('vehicle_visits').insert({
            company_id: baseId,
            driver_id: motoristaId,
            client_id: clienteId || null,
            direction,
            arrived_at: new Date().toISOString(),
            arrived_operator: operatorId,
            notes: notes || null
        })

        setSalvando(false); setModal(null); resetForm()
        await carregarVisitas(baseId, dataSelecionada)
    }

    async function registrarSaida() {
        if (!visitaSaida) return
        setSalvando(true)
        await supabase.from('vehicle_visits')
            .update({ departed_at: new Date().toISOString(), departed_operator: operatorId })
            .eq('id', visitaSaida)
        setSalvando(false); setModal(null); setVisitaSaida('')
        await carregarVisitas(baseId, dataSelecionada)
    }

    function resetForm() { setMotoristaId(''); setClienteId(''); setDirection('inbound'); setNotes(''); setErro('') }

    return (
        <main className="min-h-screen p-6" style={{ backgroundColor: '#0f1923' }}>
            <div className="max-w-2xl mx-auto">
                <button onClick={() => router.push('/dashboard')} className="text-slate-400 text-sm mb-6 hover:text-white">← Voltar</button>

                <div className="flex items-center justify-between mb-4">
                    <h1 className="text-white font-black tracking-widest uppercase text-xl">🅿️ Controle de Pátio</h1>
                    {isHoje && (
                        <button onClick={() => { setModal('entrada'); resetForm() }}
                            className="px-4 py-2 rounded font-black tracking-widest uppercase text-white text-xs"
                            style={{ backgroundColor: '#00b4b4' }}>
                            + Registrar Entrada
                        </button>
                    )}
                </div>

                <div className="flex items-center gap-3 mb-6">
                    <div className="flex items-center gap-3 px-4 py-2 rounded-lg" style={{ backgroundColor: '#1a2736' }}>
                        <span className="text-xs font-bold tracking-widest uppercase text-slate-400">Data</span>
                        <input type="date" value={dataSelecionada} onChange={handleDataChange}
                            max={hojeFormatado()} className="text-white text-sm outline-none"
                            style={{ backgroundColor: 'transparent', colorScheme: 'dark' }} />
                    </div>
                    {!isHoje && (
                        <button onClick={() => { const hoje = hojeFormatado(); setDataSelecionada(hoje); if (baseId) carregarVisitas(baseId, hoje) }}
                            className="px-3 py-2 rounded text-xs font-bold tracking-widest uppercase"
                            style={{ backgroundColor: '#00b4b4', color: 'white' }}>
                            Hoje
                        </button>
                    )}
                </div>

                <div className="rounded-lg p-5 mb-4" style={{ backgroundColor: '#1a2736' }}>
                    <p className="text-xs font-bold tracking-widest uppercase text-slate-400 mb-3">
                        {isHoje ? 'No Pátio Agora' : 'No Pátio — Sem Saída'} — {visitasAtivas.length} veículo{visitasAtivas.length !== 1 ? 's' : ''}
                    </p>
                    {visitasAtivas.length === 0
                        ? <p className="text-slate-500 text-sm">Nenhum veículo no pátio</p>
                        : (
                            <div className="flex flex-col gap-3 max-h-96 overflow-y-auto">
                                {visitasAtivas.map(v => (
                                    <div key={v.id} className="flex items-center justify-between p-3 rounded" style={{ backgroundColor: '#0f1923' }}>
                                        <div className="flex items-center gap-3">
                                            <span className="text-2xl">{vehicleIcon[(v.drivers as any)?.vehicle_type] || '🚘'}</span>
                                            <div>
                                                <p className="text-white font-bold text-sm">{(v.drivers as any)?.name}</p>
                                                <p className="text-slate-400 text-xs">
                                                    {(v.drivers as any)?.license_plate}
                                                    {v.clients && ` · ${(v.clients as any)?.name}`}
                                                    {' · '}
                                                    <span style={{ color: v.direction === 'inbound' ? '#00e676' : '#ffb300' }}>
                                                        {v.direction === 'inbound' ? '⬇️ Entrega' : '⬆️ Coleta'}
                                                    </span>
                                                </p>
                                                <p className="text-xs mt-1" style={{ color: '#00b4b4' }}>
                                                    Entrada: {formatTime(v.arrived_at)} · {tempoNoPatio(v.arrived_at)} no pátio
                                                </p>
                                            </div>
                                        </div>
                                        <button onClick={() => { setVisitaSaida(v.id); setModal('saida') }}
                                            className="px-3 py-2 rounded text-xs font-bold tracking-widest uppercase text-white"
                                            style={{ backgroundColor: '#c0392b' }}>
                                            Saída
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )
                    }
                </div>

                <div className="rounded-lg p-5" style={{ backgroundColor: '#1a2736' }}>
                    <p className="text-xs font-bold tracking-widest uppercase text-slate-400 mb-3">
                        {isHoje ? 'Histórico de Hoje' : `Histórico — ${new Date(dataSelecionada + 'T12:00:00').toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`}
                        {historicoHoje.length > 0 && ` — ${historicoHoje.length} visita${historicoHoje.length !== 1 ? 's' : ''}`}
                    </p>
                    {historicoHoje.length === 0
                        ? <p className="text-slate-500 text-sm">Nenhuma visita registrada</p>
                        : (
                            <div className="flex flex-col gap-2 max-h-96 overflow-y-auto">
                                {historicoHoje.map(v => (
                                    <div key={v.id} className="flex items-center justify-between p-3 rounded text-sm" style={{ backgroundColor: '#0f1923' }}>
                                        <div>
                                            <p className="text-white font-bold">
                                                {vehicleIcon[(v.drivers as any)?.vehicle_type]} {(v.drivers as any)?.name}
                                                <span className="text-slate-400 font-normal ml-2 text-xs">{(v.drivers as any)?.license_plate}</span>
                                            </p>
                                            <p className="text-slate-400 text-xs mt-1">
                                                {formatTime(v.arrived_at)} → {v.departed_at ? formatTime(v.departed_at) : '-'}
                                                {v.clients && ` · ${(v.clients as any)?.name}`}
                                                {v.departed_at && ` · ${tempoTotal(v.arrived_at, v.departed_at)}`}
                                            </p>
                                        </div>
                                        <span className="text-xs px-2 py-1 rounded"
                                            style={{
                                                backgroundColor: v.direction === 'inbound' ? '#0d2b1a' : '#2b1f0d',
                                                color: v.direction === 'inbound' ? '#00e676' : '#ffb300'
                                            }}>
                                            {v.direction === 'inbound' ? 'Entrega' : 'Coleta'}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        )
                    }
                </div>
            </div>

            {modal === 'entrada' && (
                <div className="fixed inset-0 flex items-center justify-center z-50 p-4" style={{ backgroundColor: 'rgba(0,0,0,0.7)' }}>
                    <div className="w-full max-w-md rounded-lg p-6 flex flex-col gap-4" style={{ backgroundColor: '#1a2736' }}>
                        <div className="flex justify-between items-center">
                            <h2 className="text-white font-black tracking-widest uppercase">Registrar Entrada</h2>
                            <button onClick={() => setModal(null)} className="text-slate-400 hover:text-white">✕</button>
                        </div>
                        <div className="flex gap-2">
                            <button onClick={() => setDirection('inbound')}
                                className="flex-1 py-2 rounded text-xs font-bold tracking-widest uppercase"
                                style={{ backgroundColor: direction === 'inbound' ? '#00e676' : '#0f1923', color: direction === 'inbound' ? '#0f1923' : 'white', border: '1px solid #2a3f52' }}>
                                ⬇️ Entrega
                            </button>
                            <button onClick={() => setDirection('outbound')}
                                className="flex-1 py-2 rounded text-xs font-bold tracking-widest uppercase"
                                style={{ backgroundColor: direction === 'outbound' ? '#ffb300' : '#0f1923', color: direction === 'outbound' ? '#0f1923' : 'white', border: '1px solid #2a3f52' }}>
                                ⬆️ Coleta
                            </button>
                        </div>
                        <div className="flex flex-col gap-1">
                            <label className="text-xs font-bold tracking-widest uppercase text-slate-400">Cliente</label>
                            <select value={clienteId} onChange={e => setClienteId(e.target.value)}
                                className="px-4 py-3 rounded text-white text-sm outline-none"
                                style={{ backgroundColor: '#0f1923', border: '1px solid #2a3f52' }}>
                                <option value="">Selecione (opcional)</option>
                                {clientes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                            </select>
                        </div>
                        <div className="flex flex-col gap-1">
                            <label className="text-xs font-bold tracking-widest uppercase text-slate-400">Motorista</label>
                            <select value={motoristaId} onChange={e => setMotoristaId(e.target.value)}
                                className="px-4 py-3 rounded text-white text-sm outline-none"
                                style={{ backgroundColor: '#0f1923', border: '1px solid #2a3f52' }}>
                                <option value="">Selecione o motorista</option>
                                {motoristas.map(m => <option key={m.id} value={m.id}>{m.name} — {m.license_plate}</option>)}
                            </select>
                            <p className="text-xs text-slate-500">
                                Motorista não cadastrado?{' '}
                                <button onClick={() => { setModal(null); router.push('/motoristas') }} className="underline" style={{ color: '#00b4b4' }}>
                                    Cadastre em Motoristas
                                </button>
                            </p>
                        </div>
                        <input value={notes} onChange={e => setNotes(e.target.value)}
                            placeholder="Observação (opcional)"
                            className="px-4 py-3 rounded text-white text-sm outline-none"
                            style={{ backgroundColor: '#0f1923', border: '1px solid #2a3f52' }} />
                        {erro && <p className="text-xs font-bold" style={{ color: '#ff5252' }}>{erro}</p>}
                        <button onClick={registrarEntrada} disabled={salvando}
                            className="py-3 rounded font-black tracking-widest uppercase text-white text-sm disabled:opacity-50"
                            style={{ backgroundColor: '#00b4b4' }}>
                            {salvando ? 'Salvando...' : 'Confirmar Entrada'}
                        </button>
                    </div>
                </div>
            )}

            {modal === 'saida' && (
                <div className="fixed inset-0 flex items-center justify-center z-50 p-4" style={{ backgroundColor: 'rgba(0,0,0,0.7)' }}>
                    <div className="w-full max-w-sm rounded-lg p-6 flex flex-col gap-4" style={{ backgroundColor: '#1a2736' }}>
                        <h2 className="text-white font-black tracking-widest uppercase">Confirmar Saída</h2>
                        <p className="text-slate-400 text-sm">Confirma a saída do veículo do pátio?</p>
                        <div className="flex gap-3">
                            <button onClick={() => { setModal(null); setVisitaSaida('') }}
                                className="flex-1 py-3 rounded font-black tracking-widest uppercase text-white text-sm"
                                style={{ backgroundColor: '#0f1923', border: '1px solid #2a3f52' }}>
                                Cancelar
                            </button>
                            <button onClick={registrarSaida} disabled={salvando}
                                className="flex-1 py-3 rounded font-black tracking-widest uppercase text-white text-sm disabled:opacity-50"
                                style={{ backgroundColor: '#c0392b' }}>
                                {salvando ? '...' : 'Confirmar Saída'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </main>
    )
}