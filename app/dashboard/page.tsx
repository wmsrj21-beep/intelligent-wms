'use client'

import { useEffect, useState } from 'react'
import { createClient } from '../lib/supabase'
import { useRouter } from 'next/navigation'

type Base = {
    id: string
    name: string
    code: string | null
}

type Stats = {
    pacotesHoje: number
    noArmazem: number
    expedidosHoje: number
    paradosUmDia: number
    possiveisPerdas: number
    lostTotal: number
}

type Permissoes = {
    recebimento: boolean
    armazem: boolean
    expedicao: boolean
    patio: boolean
    rastrear: boolean
    rua: boolean
    configuracoes: boolean
    motoristas: boolean
    inventario: boolean
    retorno: boolean
    devolucao: boolean
    localizar: boolean
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

export default function DashboardPage() {
    const [user, setUser] = useState<any>(null)
    const [permissoes, setPermissoes] = useState<Permissoes>({
        recebimento: true, armazem: true, expedicao: true,
        patio: true, rastrear: true, rua: true,
        configuracoes: true, motoristas: true, inventario: true,
        retorno: true, devolucao: true, localizar: true,
    })
    const [bases, setBases] = useState<Base[]>([])
    const [baseSelecionada, setBaseSelecionada] = useState<string>('all')
    const [stats, setStats] = useState<Stats>({ pacotesHoje: 0, noArmazem: 0, expedidosHoje: 0, paradosUmDia: 0, possiveisPerdas: 0, lostTotal: 0 })
    const [dataSelecionada, setDataSelecionada] = useState(hojeFormatado())
    const [loading, setLoading] = useState(true)
    const [isSuperAdmin, setIsSuperAdmin] = useState(false)
    const router = useRouter()
    const supabase = createClient()

    useEffect(() => {
        async function init() {
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) { router.push('/login'); return }
            setUser(user)

            const { data: userData } = await supabase
                .from('users')
                .select('company_id, name, cargo, permissoes')
                .eq('id', user.id)
                .single()
            if (!userData) return

            const cargo = userData.cargo || 'auxiliar'
            const isSA = cargo === 'super_admin'
            setIsSuperAdmin(isSA)

            if (userData.permissoes) {
                setPermissoes({
                    recebimento: true, armazem: true, expedicao: true,
                    patio: true, rastrear: true, rua: true,
                    configuracoes: true, motoristas: true, inventario: true,
                    retorno: true, devolucao: true, localizar: true,
                    ...userData.permissoes
                })
            }

            if (isSA) {
                const { data: todasBases } = await supabase
                    .from('companies').select('id, name, code').eq('active', true)
                const todasBasesData = todasBases || []
                setBases(todasBasesData)
                const savedBase = typeof window !== 'undefined' ? localStorage.getItem('wms_base_selecionada') : null
                const basesIds = todasBasesData.map((b: any) => b.id)
                const baseInicial = (savedBase && basesIds.includes(savedBase)) ? savedBase : 'all'
                setBaseSelecionada(baseInicial)
                await carregarStats(baseInicial === 'all' ? null : baseInicial, hojeFormatado())
            } else {
                const { data: userBases } = await supabase
                    .from('user_bases')
                    .select('company_id, companies(id, name, code)')
                    .eq('user_id', user.id)

                const basesDoUser = userBases?.map((ub: any) => ub.companies).filter(Boolean) || []
                if (basesDoUser.length === 0) {
                    basesDoUser.push({ id: userData.company_id, name: 'Minha Base', code: null })
                }
                setBases(basesDoUser)
                const savedBase = typeof window !== 'undefined' ? localStorage.getItem('wms_base_selecionada') : null
                const basesIds = basesDoUser.map((b: any) => b.id)
                const primeiraBase = (savedBase && basesIds.includes(savedBase)) ? savedBase : (basesDoUser[0]?.id || userData.company_id)
                setBaseSelecionada(primeiraBase)
                if (primeiraBase !== 'all') localStorage.setItem('wms_base_selecionada', primeiraBase)
                await carregarStats(primeiraBase, hojeFormatado())
            }
        }
        init()
    }, [])

    async function carregarStats(companyId: string | null, data: string) {
        setLoading(true)
        const inicio = toISOStart(data)
        const fim = toISOEnd(data)
        const umDiaAtras = new Date(Date.now() - 86400000).toISOString()
        const tresDiasAtras = new Date(Date.now() - 3 * 86400000).toISOString()

        // Busca IDs de pacotes com incidente eliminati (não são prejuízo)
        let eliminatiIds: string[] = []
        let qEliminati = supabase.from('incidents').select('package_id').eq('type', 'eliminati')
        if (companyId) qEliminati = qEliminati.eq('company_id', companyId)
        const { data: eliminatiData } = await qEliminati
        eliminatiIds = (eliminatiData || []).map((i: any) => i.package_id).filter(Boolean)

        let queries
        if (companyId) {
            queries = await Promise.all([
                supabase.from('package_events').select('id', { count: 'exact', head: true })
                    .eq('company_id', companyId).eq('event_type', 'received')
                    .gte('created_at', inicio).lte('created_at', fim),
                supabase.from('packages').select('id', { count: 'exact', head: true })
                    .eq('company_id', companyId).in('status', ['in_warehouse', 'incident']),
                supabase.from('package_events').select('id', { count: 'exact', head: true })
                    .eq('company_id', companyId).eq('event_type', 'dispatched')
                    .gte('created_at', inicio).lte('created_at', fim),
                supabase.from('packages').select('id', { count: 'exact', head: true })
                    .eq('company_id', companyId).eq('status', 'in_warehouse')
                    .lt('updated_at', umDiaAtras),
                supabase.from('packages').select('id', { count: 'exact', head: true })
                    .eq('company_id', companyId).eq('status', 'in_warehouse')
                    .lt('updated_at', tresDiasAtras),
                // Lost excluindo eliminati
                eliminatiIds.length > 0
                    ? supabase.from('packages').select('id', { count: 'exact', head: true })
                        .eq('company_id', companyId).eq('status', 'lost')
                        .not('id', 'in', `(${eliminatiIds.join(',')})`)
                    : supabase.from('packages').select('id', { count: 'exact', head: true })
                        .eq('company_id', companyId).eq('status', 'lost'),
            ])
        } else {
            queries = await Promise.all([
                supabase.from('package_events').select('id', { count: 'exact', head: true })
                    .eq('event_type', 'received').gte('created_at', inicio).lte('created_at', fim),
                supabase.from('packages').select('id', { count: 'exact', head: true })
                    .in('status', ['in_warehouse', 'incident']),
                supabase.from('package_events').select('id', { count: 'exact', head: true })
                    .eq('event_type', 'dispatched').gte('created_at', inicio).lte('created_at', fim),
                supabase.from('packages').select('id', { count: 'exact', head: true })
                    .eq('status', 'in_warehouse').lt('updated_at', umDiaAtras),
                supabase.from('packages').select('id', { count: 'exact', head: true })
                    .eq('status', 'in_warehouse').lt('updated_at', tresDiasAtras),
                eliminatiIds.length > 0
                    ? supabase.from('packages').select('id', { count: 'exact', head: true })
                        .eq('status', 'lost')
                        .not('id', 'in', `(${eliminatiIds.join(',')})`)
                    : supabase.from('packages').select('id', { count: 'exact', head: true })
                        .eq('status', 'lost'),
            ])
        }

        setStats({
            pacotesHoje: queries[0].count || 0,
            noArmazem: queries[1].count || 0,
            expedidosHoje: queries[2].count || 0,
            paradosUmDia: queries[3].count || 0,
            possiveisPerdas: queries[4].count || 0,
            lostTotal: queries[5].count || 0,
        })
        setLoading(false)
    }

    function handleBaseChange(baseId: string) {
        setBaseSelecionada(baseId)
        if (baseId !== 'all') {
            if (typeof window !== 'undefined') localStorage.setItem('wms_base_selecionada', baseId)
        }
        carregarStats(baseId === 'all' ? null : baseId, dataSelecionada)
    }

    function handleDataChange(e: React.ChangeEvent<HTMLInputElement>) {
        setDataSelecionada(e.target.value)
        carregarStats(baseSelecionada === 'all' ? null : baseSelecionada, e.target.value)
    }

    async function handleLogout() {
        await supabase.auth.signOut()
        router.push('/login')
    }

    const isHoje = dataSelecionada === hojeFormatado()

    if (!user) return null

    const modulos = [
        { key: 'recebimento', label: 'Recebimento', sub: 'Entrada de pacotes', icon: '📦', path: '/recebimento' },
        { key: 'armazem', label: 'Armazém', sub: 'Estoque e incidentes', icon: '🏭', path: '/armazem' },
        { key: 'expedicao', label: 'Expedição', sub: 'Saída de pacotes', icon: '🚚', path: '/expedicao' },
        { key: 'patio', label: 'Pátio', sub: 'Chegada e saída de veículos', icon: '🅿️', path: '/patio' },
        { key: 'rastrear', label: 'Rastrear', sub: 'Buscar pacote', icon: '🔍', path: '/rastrear' },
        { key: 'rua', label: 'Rua', sub: 'Monitoramento de rotas', icon: '🛣️', path: '/rua' },
        { key: 'inventario', label: 'Inventário', sub: 'Conferência física', icon: '📋', path: '/inventario' },
        { key: 'localizar', label: 'Localizar', sub: 'Recuperar extravios', icon: '🔎', path: '/localizar' },
        { key: 'retorno', label: 'Retorno de Rua', sub: 'Devolução de insucessos', icon: '↩️', path: '/retorno' },
        { key: 'motoristas', label: 'Motoristas', sub: 'QLP de motoristas', icon: '🚗', path: '/motoristas' },
        { key: 'devolucao', label: 'Devolução', sub: 'Devolução ao embarcador', icon: '📤', path: '/devolucao' },
        { key: 'configuracoes', label: 'Configurações', sub: 'Bases, clientes, equipe', icon: '⚙️', path: '/configuracoes' },
    ]

    const modulosVisiveis = modulos.filter(m => permissoes[m.key as keyof Permissoes])

    return (
        <main className="min-h-screen" style={{ backgroundColor: '#0f1923' }}>

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
                    <button onClick={handleLogout}
                        className="px-4 py-2 rounded text-xs font-bold tracking-widest uppercase text-white outline-none"
                        style={{ backgroundColor: '#1a2736', border: '1px solid #2a3f52' }}>
                        Sair
                    </button>
                </div>
            </header>

            <div className="px-6 pt-6 flex flex-wrap items-center gap-3">
                {(isSuperAdmin || bases.length > 1) && (
                    <div className="flex items-center gap-3 px-4 py-2 rounded-lg"
                        style={{ backgroundColor: '#1a2736' }}>
                        <span className="text-xs font-bold tracking-widest uppercase text-slate-400">Base</span>
                        <select value={baseSelecionada} onChange={e => handleBaseChange(e.target.value)}
                            className="text-white text-sm outline-none"
                            style={{ backgroundColor: 'transparent' }}>
                            {isSuperAdmin && <option value="all">Todas as Bases</option>}
                            {bases.map(b => (
                                <option key={b.id} value={b.id}>
                                    {b.code ? `${b.code} — ` : ''}{b.name}
                                </option>
                            ))}
                        </select>
                    </div>
                )}

                <div className="flex items-center gap-3 px-4 py-2 rounded-lg"
                    style={{ backgroundColor: '#1a2736' }}>
                    <span className="text-xs font-bold tracking-widest uppercase text-slate-400">Data</span>
                    <input type="date" value={dataSelecionada} onChange={handleDataChange}
                        max={hojeFormatado()}
                        className="text-white text-sm outline-none"
                        style={{ backgroundColor: 'transparent', colorScheme: 'dark' }} />
                </div>

                {!isHoje && (
                    <button onClick={() => {
                        const hoje = hojeFormatado()
                        setDataSelecionada(hoje)
                        carregarStats(baseSelecionada === 'all' ? null : baseSelecionada, hoje)
                    }}
                        className="px-3 py-2 rounded text-xs font-bold tracking-widest uppercase"
                        style={{ backgroundColor: '#00b4b4', color: 'white' }}>
                        Hoje
                    </button>
                )}

                {loading && <span className="text-slate-500 text-xs">Carregando...</span>}
            </div>

            <div className="p-6 grid grid-cols-2 lg:grid-cols-6 gap-4">
                <div className="rounded-lg p-5" style={{ backgroundColor: '#1a2736' }}>
                    <p className="text-xs font-bold tracking-widest uppercase text-slate-400">
                        {isHoje ? 'Pacotes Hoje' : 'Pacotes no Dia'}
                    </p>
                    <p className="text-3xl font-black text-white mt-2">{stats.pacotesHoje}</p>
                    <p className="text-xs text-slate-500 mt-1">Entradas registradas</p>
                </div>
                <div className="rounded-lg p-5" style={{ backgroundColor: '#1a2736' }}>
                    <p className="text-xs font-bold tracking-widest uppercase text-slate-400">No Armazém</p>
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
                <div className="rounded-lg p-5" style={{
                    backgroundColor: '#1a2736',
                    border: stats.paradosUmDia > 0 ? '1px solid #ffb300' : '1px solid transparent'
                }}>
                    <p className="text-xs font-bold tracking-widest uppercase text-slate-400">Parados +1 Dia</p>
                    <p className="text-3xl font-black mt-2"
                        style={{ color: stats.paradosUmDia > 0 ? '#ffb300' : 'white' }}>
                        {stats.paradosUmDia}
                    </p>
                    <p className="text-xs text-slate-500 mt-1">Sem movimentação</p>
                </div>
                <div className="rounded-lg p-5" style={{
                    backgroundColor: '#1a2736',
                    border: stats.possiveisPerdas > 0 ? '1px solid #ff5252' : '1px solid transparent'
                }}>
                    <p className="text-xs font-bold tracking-widest uppercase text-slate-400">Possíveis Perdas</p>
                    <p className="text-3xl font-black mt-2"
                        style={{ color: stats.possiveisPerdas > 0 ? '#ff5252' : 'white' }}>
                        {stats.possiveisPerdas}
                    </p>
                    <p className="text-xs text-slate-500 mt-1">Parados +3 dias</p>
                </div>
                <div className="rounded-lg p-5" style={{
                    backgroundColor: '#2d0a0a',
                    border: '1px solid #4a4a4a'
                }}>
                    <p className="text-xs font-bold tracking-widest uppercase" style={{ color: '#94a3b8' }}>Lost / Prejuízo</p>
                    <p className="text-3xl font-black mt-2" style={{ color: '#94a3b8' }}>
                        {stats.lostTotal}
                    </p>
                    <p className="text-xs mt-1" style={{ color: '#64748b' }}>Pacotes perdidos</p>
                </div>
            </div>

            <div className="px-6 grid grid-cols-2 lg:grid-cols-3 gap-4 pb-6">
                {modulosVisiveis.map(m => (
                    <button key={m.key}
                        onClick={() => router.push(m.path)}
                        className="rounded-lg p-6 text-left transition-opacity hover:opacity-80 outline-none"
                        style={{ backgroundColor: '#1a2736', border: '1px solid #2a3f52' }}>
                        <div className="text-3xl mb-3">{m.icon}</div>
                        <p className="text-white font-black tracking-widest uppercase text-sm">{m.label}</p>
                        <p className="text-slate-400 text-xs mt-1">{m.sub}</p>
                    </button>
                ))}
            </div>

        </main>
    )
}