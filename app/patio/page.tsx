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
    drivers: {
        name: string
        license_plate: string
        vehicle_type: string
    }
    clients: {
        name: string
    } | null
}

type Cliente = {
    id: string
    name: string
}

const vehicleIcon: Record<string, string> = {
    passeio: '🚗',
    utilitario: '🚐',
    van: '🚌',
    truck: '🚛',
    carreta: '🚚',
    moto: '🏍️',
    outros: '🚘',
}

function formatDateInput(date: Date) {
    return date.toISOString().slice(0, 10)
}

export default function PatioPage() {
    const router = useRouter()
    const supabase = createClient()

    const [companyId, setCompanyId] = useState('')
    const [operatorId, setOperatorId] = useState('')
    const [motoristas, setMotoristas] = useState<Motorista[]>([])
    const [clientes, setClientes] = useState<Cliente[]>([])
    const [visitasAtivas, setVisitasAtivas] = useState<Visita[]>([])
    const [historicoHoje, setHistoricoHoje] = useState<Visita[]>([])
    const [dataSelecionada, setDataSelecionada] = useState(formatDateInput(new Date()))

    const [modal, setModal] = useState<'entrada' | 'saida' | null>(null)
    const [visitaSaida, setVisitaSaida] = useState<string>('')

    const [motoristaId, setMotoristaId] = useState('')
    const [novoMotorista, setNovoMotorista] = useState(false)
    const [nomeNovo, setNomeNovo] = useState('')
    const [placaNova, setPlacaNova] = useState('')
    const [veiculoNovo, setVeiculoNovo] = useState('van')
    const [clienteId, setClienteId] = useState('')
    const [direction, setDirection] = useState<'inbound' | 'outbound'>('inbound')
    const [notes, setNotes] = useState('')
    const [salvando, setSalvando] = useState(false)
    const [erro, setErro] = useState('')

    const isHoje = dataSelecionada === formatDateInput(new Date())

    useEffect(() => {
        async function init() {
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) { router.push('/login'); return }
            setOperatorId(user.id)

            const { data: userData } = await supabase
                .from('users').select('company_id').eq('id', user.id).single()
            if (!userData) return
            setCompanyId(userData.company_id)

            const [motoristasRes, clientesRes] = await Promise.all([
                supabase.from('drivers').select('*').eq('company_id', userData.company_id).eq('active', true),
                supabase.from('clients').select('*').eq('company_id', userData.company_id).eq('active', true)
            ])

            setMotoristas(motoristasRes.data || [])
            setClientes(clientesRes.data || [])

            await carregarVisitas(userData.company_id, formatDateInput(new Date()))
        }
        init()
    }, [])

    async function carregarVisitas(cid: string, data: string) {
        const dataObj = new Date(data + 'T12:00:00')
        const inicio = new Date(dataObj)
        inicio.setHours(0, 0, 0, 0)
        const fim = new Date(dataObj)
        fim.setHours(23, 59, 59, 999)

        const { data: visits } = await supabase
            .from('vehicle_visits')
            .select(`
                id, direction, arrived_at, departed_at,
                arrived_operator, departed_operator, notes,
                drivers(name, license_plate, vehicle_type),
                clients(name)
            `)
            .eq('company_id', cid)
            .gte('arrived_at', inicio.toISOString())
            .lte('arrived_at', fim.toISOString())
            .order('arrived_at', { ascending: false })

        if (!visits) return

        setVisitasAtivas((visits as any[]).filter(v => !v.departed_at))
        setHistoricoHoje((visits as any[]).filter(v => v.departed_at))
    }

    function handleDataChange(e: React.ChangeEvent<HTMLInputElement>) {
        setDataSelecionada(e.target.value)
        if (companyId) carregarVisitas(companyId, e.target.value)
    }

    async function registrarEntrada() {
        if (!novoMotorista && !motoristaId) { setErro('Selecione um motorista'); return }
        if (novoMotorista && (!nomeNovo || !placaNova)) { setErro('Nome e placa obrigatórios'); return }
        setSalvando(true)
        setErro('')

        let driverId = motoristaId

        if (novoMotorista) {
            const { data, error } = await supabase.from('drivers').insert({
                company_id: companyId,
                name: nomeNovo,
                license_plate: placaNova.toUpperCase(),
                vehicle_type: veiculoNovo,
                active: true
            }).select().single()
            if (error || !data) { setErro('Erro ao cadastrar motorista'); setSalvando(false); return }
            driverId = data.id
            setMotoristas(prev => [...prev, data])
        }

        await supabase.from('vehicle_visits').insert({
            company_id: companyId,
            driver_id: driverId,
            client_id: clienteId || null,
            direction,
            arrived_at: new Date().toISOString(),
            arrived_operator: operatorId,
            notes: notes || null
        })

        setSalvando(false)
        setModal(null)
        resetForm()
        await carregarVisitas(companyId, dataSelecionada)
    }

    async function registrarSaida() {
        if (!visitaSaida) return
        setSalvando(true)

        await supabase.from('vehicle_visits')
            .update({
                departed_at: new Date().toISOString(),
                departed_operator: operatorId
            })
            .eq('id', visitaSaida)

        setSalvando(false)
        setModal(null)
        setVisitaSaida('')
        await carregarVisitas(companyId, dataSelecionada)
    }

    function resetForm() {
        setMotoristaId('')
        setNovoMotorista(false)
        setNomeNovo('')
        setPlacaNova('')
        setVeiculoNovo('van')
        setClienteId('')
        setDirection('inbound')
        setNotes('')
        setErro('')
    }

    function formatTime(dt: string) {
        return new Date(dt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    }

    function tempoNoPatio(arrived_at: string) {
        const diff = Date.now() - new Date(arrived_at).getTime()
        const mins = Math.floor(diff / 60000)
        if (mins < 60) return `${mins}min`
        return `${Math.floor(mins / 60)}h${mins % 60 > 0 ? `${mins % 60}min` : ''}`
    }

    return (
        <main className="min-h-screen p-6" style={{ backgroundColor: '#0f1923' }}>
            <div className="max-w-2xl mx-auto">
                <button onClick={() => router.push('/dashboard')}
                    className="text-slate-400 text-sm mb-6 hover:text-white">← Voltar</button>

                <div className="flex items-center justify-between mb-4">
                    <h1 className="text-white font-black tracking-widest uppercase text-xl">
                        🅿️ Controle de Pátio
                    </h1>
                    {isHoje && (
                        <button onClick={() => { setModal('entrada'); resetForm() }}
                            className="px-4 py-2 rounded font-black tracking-widest uppercase text-white text-xs"
                            style={{ backgroundColor: '#00b4b4' }}>
                            + Registrar Entrada
                        </button>
                    )}
                </div>

                {/* Filtro de data */}
                <div className="flex items-center gap-3 mb-6">
                    <div className="flex items-center gap-3 px-4 py-2 rounded-lg"
                        style={{ backgroundColor: '#1a2736' }}>
                        <span className="text-xs font-bold tracking-widest uppercase text-slate-400">Data</span>
                        <input
                            type="date"
                            value={dataSelecionada}
                            onChange={handleDataChange}
                            max={formatDateInput(new Date())}
                            className="text-white text-sm outline-none"
                            style={{ backgroundColor: 'transparent', colorScheme: 'dark' }}
                        />
                    </div>
                    {!isHoje && (
                        <button
                            onClick={() => {
                                const hoje = formatDateInput(new Date())
                                setDataSelecionada(hoje)
                                if (companyId) carregarVisitas(companyId, hoje)
                            }}
                            className="px-3 py-2 rounded text-xs font-bold tracking-widest uppercase"
                            style={{ backgroundColor: '#00b4b4', color: 'white' }}>
                            Hoje
                        </button>
                    )}
                </div>

                {/* Pátio — veículos ativos (só mostra se for hoje) */}
                {isHoje && (
                    <div className="rounded-lg p-5 mb-4" style={{ backgroundColor: '#1a2736' }}>
                        <p className="text-xs font-bold tracking-widest uppercase text-slate-400 mb-3">
                            No Pátio Agora — {visitasAtivas.length} veículo{visitasAtivas.length !== 1 ? 's' : ''}
                        </p>

                        {visitasAtivas.length === 0 && (
                            <p className="text-slate-500 text-sm">Nenhum veículo no pátio</p>
                        )}

                        <div className="flex flex-col gap-3">
                            {visitasAtivas.map(v => (
                                <div key={v.id} className="flex items-center justify-between p-3 rounded"
                                    style={{ backgroundColor: '#0f1923' }}>
                                    <div className="flex items-center gap-3">
                                        <span className="text-2xl">
                                            {vehicleIcon[(v.drivers as any)?.vehicle_type] || '🚘'}
                                        </span>
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
                                    <button
                                        onClick={() => { setVisitaSaida(v.id); setModal('saida') }}
                                        className="px-3 py-2 rounded text-xs font-bold tracking-widest uppercase text-white"
                                        style={{ backgroundColor: '#c0392b' }}>
                                        Saída
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Histórico */}
                <div className="rounded-lg p-5" style={{ backgroundColor: '#1a2736' }}>
                    <p className="text-xs font-bold tracking-widest uppercase text-slate-400 mb-3">
                        {isHoje ? 'Histórico de Hoje' : `Histórico — ${new Date(dataSelecionada + 'T12:00:00').toLocaleDateString('pt-BR')}`}
                        {historicoHoje.length > 0 && ` — ${historicoHoje.length} visita${historicoHoje.length !== 1 ? 's' : ''}`}
                    </p>

                    {historicoHoje.length === 0 && (
                        <p className="text-slate-500 text-sm">Nenhuma visita registrada</p>
                    )}

                    <div className="flex flex-col gap-2">
                        {historicoHoje.map(v => (
                            <div key={v.id} className="flex items-center justify-between p-3 rounded text-sm"
                                style={{ backgroundColor: '#0f1923' }}>
                                <div>
                                    <p className="text-white font-bold">
                                        {vehicleIcon[(v.drivers as any)?.vehicle_type]} {(v.drivers as any)?.name}
                                        <span className="text-slate-400 font-normal ml-2 text-xs">
                                            {(v.drivers as any)?.license_plate}
                                        </span>
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
                </div>
            </div>

            {/* Modal Entrada */}
            {modal === 'entrada' && (
                <div className="fixed inset-0 flex items-center justify-center z-50 p-4"
                    style={{ backgroundColor: 'rgba(0,0,0,0.7)' }}>
                    <div className="w-full max-w-md rounded-lg p-6 flex flex-col gap-4"
                        style={{ backgroundColor: '#1a2736' }}>
                        <div className="flex justify-between items-center">
                            <h2 className="text-white font-black tracking-widest uppercase">Registrar Entrada</h2>
                            <button onClick={() => setModal(null)} className="text-slate-400 hover:text-white">✕</button>
                        </div>

                        <div className="flex gap-2">
                            <button onClick={() => setDirection('inbound')}
                                className="flex-1 py-2 rounded text-xs font-bold tracking-widest uppercase"
                                style={{
                                    backgroundColor: direction === 'inbound' ? '#00e676' : '#0f1923',
                                    color: direction === 'inbound' ? '#0f1923' : 'white',
                                    border: '1px solid #2a3f52'
                                }}>
                                ⬇️ Entrega
                            </button>
                            <button onClick={() => setDirection('outbound')}
                                className="flex-1 py-2 rounded text-xs font-bold tracking-widest uppercase"
                                style={{
                                    backgroundColor: direction === 'outbound' ? '#ffb300' : '#0f1923',
                                    color: direction === 'outbound' ? '#0f1923' : 'white',
                                    border: '1px solid #2a3f52'
                                }}>
                                ⬆️ Coleta
                            </button>
                        </div>

                        <div className="flex flex-col gap-1">
                            <label className="text-xs font-bold tracking-widest uppercase text-slate-400">Cliente</label>
                            <select value={clienteId} onChange={e => setClienteId(e.target.value)}
                                className="px-4 py-3 rounded text-white text-sm outline-none"
                                style={{ backgroundColor: '#0f1923', border: '1px solid #2a3f52' }}>
                                <option value="">Selecione (opcional)</option>
                                {clientes.map(c => (
                                    <option key={c.id} value={c.id}>{c.name}</option>
                                ))}
                            </select>
                        </div>

                        <div className="flex gap-2">
                            <button onClick={() => setNovoMotorista(false)}
                                className="flex-1 py-2 rounded text-xs font-bold tracking-widest uppercase"
                                style={{
                                    backgroundColor: !novoMotorista ? '#00b4b4' : '#0f1923',
                                    color: 'white', border: '1px solid #2a3f52'
                                }}>
                                Cadastrado
                            </button>
                            <button onClick={() => setNovoMotorista(true)}
                                className="flex-1 py-2 rounded text-xs font-bold tracking-widest uppercase"
                                style={{
                                    backgroundColor: novoMotorista ? '#00b4b4' : '#0f1923',
                                    color: 'white', border: '1px solid #2a3f52'
                                }}>
                                Novo
                            </button>
                        </div>

                        {!novoMotorista && (
                            <select value={motoristaId} onChange={e => setMotoristaId(e.target.value)}
                                className="px-4 py-3 rounded text-white text-sm outline-none"
                                style={{ backgroundColor: '#0f1923', border: '1px solid #2a3f52' }}>
                                <option value="">Selecione o motorista</option>
                                {motoristas.map(m => (
                                    <option key={m.id} value={m.id}>
                                        {m.name} — {m.license_plate}
                                    </option>
                                ))}
                            </select>
                        )}

                        {novoMotorista && (
                            <div className="flex flex-col gap-2">
                                <input value={nomeNovo} onChange={e => setNomeNovo(e.target.value)}
                                    placeholder="Nome do motorista *"
                                    className="px-4 py-3 rounded text-white text-sm outline-none"
                                    style={{ backgroundColor: '#0f1923', border: '1px solid #2a3f52' }} />
                                <input value={placaNova} onChange={e => setPlacaNova(e.target.value.toUpperCase())}
                                    placeholder="Placa *"
                                    className="px-4 py-3 rounded text-white text-sm outline-none"
                                    style={{ backgroundColor: '#0f1923', border: '1px solid #2a3f52' }} />
                                <select value={veiculoNovo} onChange={e => setVeiculoNovo(e.target.value)}
                                    className="px-4 py-3 rounded text-white text-sm outline-none"
                                    style={{ backgroundColor: '#0f1923', border: '1px solid #2a3f52' }}>
                                    <option value="passeio">Passeio</option>
                                    <option value="utilitario">Utilitário</option>
                                    <option value="van">Van</option>
                                    <option value="truck">Truck</option>
                                    <option value="carreta">Carreta</option>
                                    <option value="moto">Moto</option>
                                    <option value="outros">Outros</option>
                                </select>
                            </div>
                        )}

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

            {/* Modal Saída */}
            {modal === 'saida' && (
                <div className="fixed inset-0 flex items-center justify-center z-50 p-4"
                    style={{ backgroundColor: 'rgba(0,0,0,0.7)' }}>
                    <div className="w-full max-w-sm rounded-lg p-6 flex flex-col gap-4"
                        style={{ backgroundColor: '#1a2736' }}>
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

function tempoTotal(arrived: string, departed: string) {
    const diff = new Date(departed).getTime() - new Date(arrived).getTime()
    const mins = Math.floor(diff / 60000)
    if (mins < 60) return `${mins}min no pátio`
    return `${Math.floor(mins / 60)}h${mins % 60 > 0 ? `${mins % 60}min` : ''} no pátio`
}