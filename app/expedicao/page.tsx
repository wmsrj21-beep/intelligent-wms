'use client'

import { useState, useRef, useEffect } from 'react'
import { createClient } from '../lib/supabase'
import { useRouter } from 'next/navigation'

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
}

type PacoteBipado = {
    id: string
    barcode: string
    client_name: string
    status: 'ok' | 'erro'
    msg: string
}

export default function ExpedicaoPage() {
    const router = useRouter()
    const supabase = createClient()
    const inputRef = useRef<HTMLInputElement>(null)

    const [companyId, setCompanyId] = useState('')
    const [operatorId, setOperatorId] = useState('')
    const [operatorName, setOperatorName] = useState('')

    const [motoristas, setMotoristas] = useState<Motorista[]>([])
    const [expedicoesHoje, setExpedicoesHoje] = useState<ExpedicaoAtiva[]>([])
    const [motoristaId, setMotoristaId] = useState('')
    const [novoMotorista, setNovoMotorista] = useState(false)
    const [nome, setNome] = useState('')
    const [cpf, setCpf] = useState('')
    const [placa, setPlaca] = useState('')
    const [veiculo, setVeiculo] = useState('van')

    const [fase, setFase] = useState<'setup' | 'bipando' | 'resultado'>('setup')
    const [barcode, setBarcode] = useState('')
    const [bipados, setBipados] = useState<PacoteBipado[]>([])
    const [feedback, setFeedback] = useState<{ msg: string; tipo: 'ok' | 'erro' } | null>(null)
    const [salvando, setSalvando] = useState(false)
    const [erroMsg, setErroMsg] = useState('')

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

            const { data: motoristasData } = await supabase
                .from('drivers').select('*').eq('company_id', userData.company_id).eq('active', true)
            setMotoristas(motoristasData || [])

            await carregarExpedicoesHoje(userData.company_id)
        }
        init()
    }, [])

    async function carregarExpedicoesHoje(cid: string) {
        const hoje = new Date()
        hoje.setHours(0, 0, 0, 0)

        const { data } = await supabase
            .from('package_events')
            .select('driver_id, driver_name, packages(id)')
            .eq('company_id', cid)
            .eq('event_type', 'dispatched')
            .gte('created_at', hoje.toISOString())

        if (!data) return

        const agrupado: Record<string, ExpedicaoAtiva> = {}
        for (const ev of data) {
            if (!ev.driver_id) continue
            if (!agrupado[ev.driver_id]) {
                const motorista = motoristas.find((m: any) => m.id === ev.driver_id)
                agrupado[ev.driver_id] = {
                    motorista_id: ev.driver_id,
                    motorista_nome: ev.driver_name || '-',
                    placa: motorista?.license_plate || '-',
                    total: 0
                }
            }
            agrupado[ev.driver_id].total++
        }
        setExpedicoesHoje(Object.values(agrupado))
    }

    async function iniciarExpedicao() {
        if (!novoMotorista && !motoristaId) {
            setErroMsg('Selecione ou cadastre um motorista')
            return
        }
        if (novoMotorista && (!nome || !placa)) {
            setErroMsg('Nome e placa são obrigatórios')
            return
        }
        setErroMsg('')

        if (novoMotorista) {
            const { data, error } = await supabase.from('drivers').insert({
                company_id: companyId,
                name: nome,
                cpf: cpf || null,
                license_plate: placa,
                vehicle_type: veiculo,
                active: true
            }).select().single()

            if (error || !data) { setErroMsg('Erro ao cadastrar motorista'); return }
            setMotoristaId(data.id)
            setMotoristas(prev => [...prev, data])
        }

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
            setFeedback({ msg: `⚠️ ${codigo} já foi bipado`, tipo: 'erro' })
            setTimeout(() => setFeedback(null), 2000)
            inputRef.current?.focus()
            return
        }

        const { data: pkg } = await supabase
            .from('packages')
            .select('id, status, clients(name)')
            .eq('barcode', codigo)
            .eq('company_id', companyId)
            .single()

        if (!pkg) {
            setBipados(prev => [...prev, {
                id: '', barcode: codigo,
                client_name: '-', status: 'erro',
                msg: 'Pacote não encontrado'
            }])
            setFeedback({ msg: `❌ ${codigo} — não encontrado`, tipo: 'erro' })
            setTimeout(() => setFeedback(null), 2000)
            inputRef.current?.focus()
            return
        }

        if (pkg.status !== 'in_warehouse') {
            setBipados(prev => [...prev, {
                id: pkg.id, barcode: codigo,
                client_name: (pkg.clients as any)?.name || '-',
                status: 'erro',
                msg: `Não está no armazém`
            }])
            setFeedback({ msg: `❌ ${codigo} — não está no armazém`, tipo: 'erro' })
            setTimeout(() => setFeedback(null), 2000)
            inputRef.current?.focus()
            return
        }

        setBipados(prev => [...prev, {
            id: pkg.id, barcode: codigo,
            client_name: (pkg.clients as any)?.name || '-',
            status: 'ok', msg: 'Pronto para expedir'
        }])
        setFeedback({ msg: `✅ ${codigo}`, tipo: 'ok' })
        setTimeout(() => setFeedback(null), 1500)
        inputRef.current?.focus()
    }

    async function finalizarExpedicao() {
        const validos = bipados.filter(b => b.status === 'ok')
        if (validos.length === 0) {
            setErroMsg('Nenhum pacote válido para expedir')
            return
        }
        setSalvando(true)
        setErroMsg('')

        const motorista = motoristas.find(m => m.id === motoristaId)

        for (const pkg of validos) {
            await supabase.from('packages')
                .update({ status: 'dispatched' })
                .eq('id', pkg.id)

            await supabase.from('package_events').insert({
                package_id: pkg.id,
                company_id: companyId,
                event_type: 'dispatched',
                operator_id: operatorId,
                operator_name: operatorName,
                driver_id: motoristaId,
                driver_name: motorista?.name || nome,
            })
        }

        setSalvando(false)
        setFase('resultado')
    }

    const motoristaSelecionado = motoristas.find(m => m.id === motoristaId)

    // ─── SETUP ───
    if (fase === 'setup') return (
        <main className="min-h-screen p-6" style={{ backgroundColor: '#0f1923' }}>
            <div className="max-w-lg mx-auto">
                <button onClick={() => router.push('/dashboard')}
                    className="text-slate-400 text-sm mb-6 hover:text-white">← Voltar</button>
                <h1 className="text-white font-black tracking-widest uppercase text-xl mb-6">
                    🚚 Expedição
                </h1>

                {/* Expedições do dia */}
                {expedicoesHoje.length > 0 && (
                    <div className="rounded-lg p-5 mb-6" style={{ backgroundColor: '#1a2736' }}>
                        <p className="text-xs font-bold tracking-widest uppercase text-slate-400 mb-3">
                            Expedições de Hoje
                        </p>
                        <div className="flex flex-col gap-2">
                            {expedicoesHoje.map(exp => (
                                <div key={exp.motorista_id}
                                    className="flex items-center justify-between p-3 rounded"
                                    style={{ backgroundColor: '#0f1923' }}>
                                    <div>
                                        <p className="text-white font-bold text-sm">{exp.motorista_nome}</p>
                                        <p className="text-slate-400 text-xs">{exp.placa} · {exp.total} pacotes</p>
                                    </div>
                                    <button onClick={() => continuarExpedicao(exp)}
                                        className="px-3 py-2 rounded text-xs font-bold tracking-widest uppercase"
                                        style={{ backgroundColor: '#00b4b4', color: 'white' }}>
                                        Continuar
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Nova expedição */}
                <div className="rounded-lg p-6 flex flex-col gap-5" style={{ backgroundColor: '#1a2736' }}>
                    <p className="text-xs font-bold tracking-widest uppercase text-slate-400">
                        Nova Expedição
                    </p>

                    <div className="flex gap-2">
                        <button onClick={() => setNovoMotorista(false)}
                            className="flex-1 py-2 rounded text-xs font-bold tracking-widest uppercase"
                            style={{
                                backgroundColor: !novoMotorista ? '#00b4b4' : '#0f1923',
                                color: 'white', border: '1px solid #2a3f52'
                            }}>
                            Motorista Cadastrado
                        </button>
                        <button onClick={() => setNovoMotorista(true)}
                            className="flex-1 py-2 rounded text-xs font-bold tracking-widest uppercase"
                            style={{
                                backgroundColor: novoMotorista ? '#00b4b4' : '#0f1923',
                                color: 'white', border: '1px solid #2a3f52'
                            }}>
                            Novo Motorista
                        </button>
                    </div>

                    {!novoMotorista && (
                        <div className="flex flex-col gap-2">
                            <label className="text-xs font-bold tracking-widest uppercase text-slate-400">
                                Selecione o Motorista
                            </label>
                            <select value={motoristaId} onChange={e => setMotoristaId(e.target.value)}
                                className="px-4 py-3 rounded text-white text-sm outline-none"
                                style={{ backgroundColor: '#0f1923', border: '1px solid #2a3f52' }}>
                                <option value="">Selecione...</option>
                                {motoristas.map(m => (
                                    <option key={m.id} value={m.id}>
                                        {m.name} — {m.license_plate} ({m.vehicle_type})
                                    </option>
                                ))}
                            </select>
                        </div>
                    )}

                    {novoMotorista && (
                        <div className="flex flex-col gap-3">
                            <div className="flex flex-col gap-1">
                                <label className="text-xs font-bold tracking-widest uppercase text-slate-400">Nome *</label>
                                <input value={nome} onChange={e => setNome(e.target.value)}
                                    placeholder="Nome completo"
                                    className="px-4 py-3 rounded text-white text-sm outline-none"
                                    style={{ backgroundColor: '#0f1923', border: '1px solid #2a3f52' }} />
                            </div>
                            <div className="flex flex-col gap-1">
                                <label className="text-xs font-bold tracking-widest uppercase text-slate-400">CPF</label>
                                <input value={cpf} onChange={e => setCpf(e.target.value)}
                                    placeholder="000.000.000-00"
                                    className="px-4 py-3 rounded text-white text-sm outline-none"
                                    style={{ backgroundColor: '#0f1923', border: '1px solid #2a3f52' }} />
                            </div>
                            <div className="flex flex-col gap-1">
                                <label className="text-xs font-bold tracking-widest uppercase text-slate-400">Placa *</label>
                                <input value={placa} onChange={e => setPlaca(e.target.value.toUpperCase())}
                                    placeholder="ABC1234"
                                    className="px-4 py-3 rounded text-white text-sm outline-none"
                                    style={{ backgroundColor: '#0f1923', border: '1px solid #2a3f52' }} />
                            </div>
                            <div className="flex flex-col gap-1">
                                <label className="text-xs font-bold tracking-widest uppercase text-slate-400">Tipo de Veículo</label>
                                <select value={veiculo} onChange={e => setVeiculo(e.target.value)}
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
                        </div>
                    )}

                    {erroMsg && (
                        <p className="text-xs font-bold" style={{ color: '#ff5252' }}>{erroMsg}</p>
                    )}

                    <button onClick={iniciarExpedicao}
                        className="py-3 rounded font-black tracking-widest uppercase text-white text-sm"
                        style={{ backgroundColor: '#00b4b4' }}>
                        Iniciar Expedição
                    </button>
                </div>
            </div>
        </main>
    )

    // ─── BIPANDO ───
    if (fase === 'bipando') return (
        <main className="min-h-screen p-6" style={{ backgroundColor: '#0f1923' }}>
            <div className="max-w-2xl mx-auto">
                <button onClick={() => setFase('setup')}
                    className="text-slate-400 text-sm mb-6 hover:text-white">← Voltar</button>

                <h1 className="text-white font-black tracking-widest uppercase text-xl mb-2">
                    🚚 Expedindo Pacotes
                </h1>
                <p className="text-slate-400 text-sm mb-6">
                    Motorista: {motoristaSelecionado?.name || nome} — {motoristaSelecionado?.license_plate || placa}
                </p>

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
                            backgroundColor: feedback.tipo === 'ok' ? '#0d2b1a' : '#2b0d0d',
                            color: feedback.tipo === 'ok' ? '#00e676' : '#ff5252',
                            border: `1px solid ${feedback.tipo === 'ok' ? '#00e676' : '#ff5252'}`
                        }}>
                        {feedback.msg}
                    </div>
                )}

                <div className="rounded-lg p-4 mb-4 flex justify-between"
                    style={{ backgroundColor: '#1a2736' }}>
                    <span className="text-slate-400 text-sm">
                        Total: <span className="text-white font-bold">{bipados.length}</span>
                    </span>
                    <span className="text-sm">
                        <span style={{ color: '#00e676' }}>{bipados.filter(b => b.status === 'ok').length} ok</span>
                        {' · '}
                        <span style={{ color: '#ff5252' }}>{bipados.filter(b => b.status === 'erro').length} erro</span>
                    </span>
                </div>

                <div className="rounded-lg p-4 mb-4" style={{ backgroundColor: '#1a2736' }}>
                    <p className="text-xs font-bold tracking-widest uppercase text-slate-400 mb-3">
                        Últimos bipados
                    </p>
                    <div className="flex flex-col gap-2 max-h-48 overflow-y-auto">
                        {[...bipados].reverse().slice(0, 15).map((b, i) => (
                            <div key={i} className="flex items-center justify-between text-sm">
                                <div>
                                    <span className="text-white font-mono">{b.barcode}</span>
                                    <span className="text-slate-500 text-xs ml-2">{b.client_name}</span>
                                </div>
                                <span className="text-xs font-bold"
                                    style={{ color: b.status === 'ok' ? '#00e676' : '#ff5252' }}>
                                    {b.status === 'ok' ? '✅ OK' : `❌ ${b.msg}`}
                                </span>
                            </div>
                        ))}
                        {bipados.length === 0 && (
                            <p className="text-slate-500 text-sm">Nenhum pacote bipado ainda</p>
                        )}
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

    // ─── RESULTADO ───
    return (
        <main className="min-h-screen p-6" style={{ backgroundColor: '#0f1923' }}>
            <div className="max-w-lg mx-auto">
                <h1 className="text-white font-black tracking-widest uppercase text-xl mb-6">
                    ✅ Expedição Finalizada
                </h1>

                <div className="rounded-lg p-6 flex flex-col gap-4" style={{ backgroundColor: '#1a2736' }}>
                    <div className="flex justify-between">
                        <span className="text-slate-400 text-sm">Motorista</span>
                        <span className="text-white font-bold text-sm">{motoristaSelecionado?.name || nome}</span>
                    </div>
                    <div className="flex justify-between">
                        <span className="text-slate-400 text-sm">Placa</span>
                        <span className="text-white font-bold text-sm">{motoristaSelecionado?.license_plate || placa}</span>
                    </div>
                    <div className="flex justify-between">
                        <span className="text-slate-400 text-sm">Pacotes expedidos</span>
                        <span className="font-black text-2xl" style={{ color: '#00e676' }}>
                            {bipados.filter(b => b.status === 'ok').length}
                        </span>
                    </div>
                    {bipados.filter(b => b.status === 'erro').length > 0 && (
                        <div className="flex justify-between">
                            <span className="text-slate-400 text-sm">Com erro</span>
                            <span className="font-black text-2xl" style={{ color: '#ff5252' }}>
                                {bipados.filter(b => b.status === 'erro').length}
                            </span>
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