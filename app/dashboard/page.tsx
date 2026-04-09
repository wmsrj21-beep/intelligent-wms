'use client'

import { useEffect, useState } from 'react'
import { createClient } from '../lib/supabase'
import { useRouter } from 'next/navigation'

type Stats = {
    pacotesHoje: number
    noArmazem: number
    expedidosHoje: number
    divergencias: number
}

function toLocalISOStart(date: Date) {
    const d = new Date(date)
    d.setHours(0, 0, 0, 0)
    return d.toISOString()
}

function toLocalISOEnd(date: Date) {
    const d = new Date(date)
    d.setHours(23, 59, 59, 999)
    return d.toISOString()
}

function formatDateInput(date: Date) {
    return date.toISOString().slice(0, 10)
}

export default function DashboardPage() {
    const [user, setUser] = useState<any>(null)
    const [companyId, setCompanyId] = useState('')
    const [stats, setStats] = useState<Stats>({
        pacotesHoje: 0,
        noArmazem: 0,
        expedidosHoje: 0,
        divergencias: 0
    })
    const [dataSelecionada, setDataSelecionada] = useState(formatDateInput(new Date()))
    const [loading, setLoading] = useState(true)
    const router = useRouter()
    const supabase = createClient()

    useEffect(() => {
        async function init() {
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) { router.push('/login'); return }
            setUser(user)

            const { data: userData } = await supabase
                .from('users').select('company_id').eq('id', user.id).single()
            if (!userData) return
            setCompanyId(userData.company_id)
            await carregarStats(userData.company_id, formatDateInput(new Date()))
        }
        init()
    }, [])

    async function carregarStats(cid: string, data: string) {
        setLoading(true)
        const dataObj = new Date(data + 'T12:00:00')
        const inicio = toLocalISOStart(dataObj)
        const fim = toLocalISOEnd(dataObj)

        const [recebidos, armazem, expedidos, divergencias] = await Promise.all([
            supabase.from('packages')
                .select('id', { count: 'exact', head: true })
                .eq('company_id', cid)
                .gte('created_at', inicio)
                .lte('created_at', fim),

            supabase.from('packages')
                .select('id', { count: 'exact', head: true })
                .eq('company_id', cid)
                .eq('status', 'in_warehouse'),

            supabase.from('package_events')
                .select('id', { count: 'exact', head: true })
                .eq('company_id', cid)
                .eq('event_type', 'dispatched')
                .gte('created_at', inicio)
                .lte('created_at', fim),

            supabase.from('packages')
                .select('id', { count: 'exact', head: true })
                .eq('company_id', cid)
                .eq('status', 'unsuccessful'),
        ])

        setStats({
            pacotesHoje: recebidos.count || 0,
            noArmazem: armazem.count || 0,
            expedidosHoje: expedidos.count || 0,
            divergencias: divergencias.count || 0,
        })
        setLoading(false)
    }

    async function handleLogout() {
        await supabase.auth.signOut()
        router.push('/login')
    }

    function handleDataChange(e: React.ChangeEvent<HTMLInputElement>) {
        setDataSelecionada(e.target.value)
        if (companyId) carregarStats(companyId, e.target.value)
    }

    const isHoje = dataSelecionada === formatDateInput(new Date())

    if (!user) return null

    return (
        <main className="min-h-screen" style={{ backgroundColor: '#0f1923' }}>

            {/* Header */}
            <header className="px-6 py-4 flex items-center justify-between"
                style={{ backgroundColor: '#0d1720', borderBottom: '1px solid #1a2736' }}>
                <div>
                    <h1 className="text-white font-black tracking-widest uppercase text-lg">
                        Intelligent WMS
                    </h1>
                    <p className="text-xs tracking-widest uppercase" style={{ color: '#00b4b4' }}>
                        Painel de Controle
                    </p>
                </div>
                <div className="flex items-center gap-4">
                    <span className="text-slate-400 text-sm">{user.email}</span>
                    <button
                        onClick={handleLogout}
                        className="px-4 py-2 rounded text-xs font-bold tracking-widest uppercase text-white"
                        style={{ backgroundColor: '#1a2736', border: '1px solid #2a3f52' }}>
                        Sair
                    </button>
                </div>
            </header>

            {/* Filtro de data */}
            <div className="px-6 pt-6 flex items-center gap-4">
                <div className="flex items-center gap-3 px-4 py-2 rounded-lg"
                    style={{ backgroundColor: '#1a2736' }}>
                    <span className="text-xs font-bold tracking-widest uppercase text-slate-400">
                        Data
                    </span>
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
                            if (companyId) carregarStats(companyId, hoje)
                        }}
                        className="px-3 py-2 rounded text-xs font-bold tracking-widest uppercase"
                        style={{ backgroundColor: '#00b4b4', color: 'white' }}>
                        Hoje
                    </button>
                )}
                {loading && (
                    <span className="text-slate-500 text-xs">Carregando...</span>
                )}
            </div>

            {/* Cards */}
            <div className="p-6 grid grid-cols-2 lg:grid-cols-4 gap-4">

                <div className="rounded-lg p-5" style={{ backgroundColor: '#1a2736' }}>
                    <p className="text-xs font-bold tracking-widest uppercase text-slate-400">
                        {isHoje ? 'Pacotes Hoje' : 'Pacotes no Dia'}
                    </p>
                    <p className="text-3xl font-black text-white mt-2">{stats.pacotesHoje}</p>
                    <p className="text-xs text-slate-500 mt-1">Entradas registradas</p>
                </div>

                <div className="rounded-lg p-5" style={{ backgroundColor: '#1a2736' }}>
                    <p className="text-xs font-bold tracking-widest uppercase text-slate-400">
                        No Armazém
                    </p>
                    <p className="text-3xl font-black text-white mt-2">{stats.noArmazem}</p>
                    <p className="text-xs text-slate-500 mt-1">Pacotes em estoque</p>
                </div>

                <div className="rounded-lg p-5" style={{ backgroundColor: '#1a2736' }}>
                    <p className="text-xs font-bold tracking-widest uppercase text-slate-400">
                        {isHoje ? 'Expedidos Hoje' : 'Expedidos no Dia'}
                    </p>
                    <p className="text-3xl font-black text-white mt-2">{stats.expedidosHoje}</p>
                    <p className="text-xs text-slate-500 mt-1">Saídas registradas</p>
                </div>

                <div className="rounded-lg p-5"
                    style={{
                        backgroundColor: '#1a2736',
                        border: stats.divergencias > 0 ? '1px solid #ff5252' : 'none'
                    }}>
                    <p className="text-xs font-bold tracking-widest uppercase text-slate-400">
                        Divergências
                    </p>
                    <p className="text-3xl font-black mt-2"
                        style={{ color: stats.divergencias > 0 ? '#ff5252' : 'white' }}>
                        {stats.divergencias}
                    </p>
                    <p className="text-xs text-slate-500 mt-1">Insucessos pendentes</p>
                </div>

            </div>

            {/* Menu de módulos */}
            <div className="px-6 grid grid-cols-2 lg:grid-cols-3 gap-4">

                <button
                    onClick={() => router.push('/recebimento')}
                    className="rounded-lg p-6 text-left transition-opacity hover:opacity-80"
                    style={{ backgroundColor: '#1a2736', border: '1px solid #2a3f52' }}>
                    <div className="text-3xl mb-3">📦</div>
                    <p className="text-white font-black tracking-widest uppercase text-sm">Recebimento</p>
                    <p className="text-slate-400 text-xs mt-1">Entrada de pacotes</p>
                </button>

                <button
                    onClick={() => router.push('/armazem')}
                    className="rounded-lg p-6 text-left transition-opacity hover:opacity-80"
                    style={{ backgroundColor: '#1a2736', border: '1px solid #2a3f52' }}>
                    <div className="text-3xl mb-3">🏭</div>
                    <p className="text-white font-black tracking-widest uppercase text-sm">Armazém</p>
                    <p className="text-slate-400 text-xs mt-1">Movimentação interna</p>
                </button>

                <button
                    onClick={() => router.push('/expedicao')}
                    className="rounded-lg p-6 text-left transition-opacity hover:opacity-80"
                    style={{ backgroundColor: '#1a2736', border: '1px solid #2a3f52' }}>
                    <div className="text-3xl mb-3">🚚</div>
                    <p className="text-white font-black tracking-widest uppercase text-sm">Expedição</p>
                    <p className="text-slate-400 text-xs mt-1">Saída de pacotes</p>
                </button>

                <button
                    onClick={() => router.push('/patio')}
                    className="rounded-lg p-6 text-left transition-opacity hover:opacity-80"
                    style={{ backgroundColor: '#1a2736', border: '1px solid #2a3f52' }}>
                    <div className="text-3xl mb-3">🅿️</div>
                    <p className="text-white font-black tracking-widest uppercase text-sm">Pátio</p>
                    <p className="text-slate-400 text-xs mt-1">Chegada e saída de veículos</p>
                </button>

                <button
                    onClick={() => router.push('/rastrear')}
                    className="rounded-lg p-6 text-left transition-opacity hover:opacity-80"
                    style={{ backgroundColor: '#1a2736', border: '1px solid #2a3f52' }}>
                    <div className="text-3xl mb-3">🔍</div>
                    <p className="text-white font-black tracking-widest uppercase text-sm">Rastrear</p>
                    <p className="text-slate-400 text-xs mt-1">Buscar pacote</p>
                </button>

                <button
                    onClick={() => router.push('/rua')}
                    className="rounded-lg p-6 text-left transition-opacity hover:opacity-80"
                    style={{ backgroundColor: '#1a2736', border: '1px solid #2a3f52' }}>
                    <div className="text-3xl mb-3">🛣️</div>
                    <p className="text-white font-black tracking-widest uppercase text-sm">Rua</p>
                    <p className="text-slate-400 text-xs mt-1">Monitoramento de rotas</p>
                </button>

                <button
                    onClick={() => router.push('/configuracoes')}
                    className="rounded-lg p-6 text-left transition-opacity hover:opacity-80"
                    style={{ backgroundColor: '#1a2736', border: '1px solid #2a3f52' }}>
                    <div className="text-3xl mb-3">⚙️</div>
                    <p className="text-white font-black tracking-widest uppercase text-sm">Configurações</p>
                    <p className="text-slate-400 text-xs mt-1">Clientes e operadores</p>
                </button>

            </div>

        </main>
    )
}