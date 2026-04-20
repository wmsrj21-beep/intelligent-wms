'use client'

import { useState, useEffect } from 'react'
import { createClient } from '../lib/supabase'
import { useRouter } from 'next/navigation'

type Base = { id: string; name: string; code: string | null; active: boolean }
type Cliente = { id: string; name: string; code: string | null; active: boolean; company_id: string }
type Funcionario = {
    id: string; name: string; cargo: string; active: boolean
    company_id: string; permissoes: Record<string, boolean>
}
type Motorista = {
    id: string; name: string; cpf: string | null
    license_plate: string; vehicle_type: string
    status: string; blocked_reason: string | null
    active: boolean; company_id: string
}

const cargos = [
    'super_admin', 'admin', 'gerente', 'coordenador',
    'supervisor', 'encarregado', 'lider', 'assistente', 'auxiliar'
]

const modulos = [
    { key: 'recebimento', label: 'Recebimento' },
    { key: 'armazem', label: 'Armazém' },
    { key: 'expedicao', label: 'Expedição' },
    { key: 'patio', label: 'Pátio' },
    { key: 'rastrear', label: 'Rastrear' },
    { key: 'rua', label: 'Rua' },
    { key: 'inventario', label: 'Inventário' },
    { key: 'motoristas', label: 'Motoristas' },
    { key: 'configuracoes', label: 'Configurações' },
]

const statusMotorista: Record<string, { label: string; color: string; bg: string }> = {
    active: { label: 'Ativo', color: '#00e676', bg: '#0d2b1a' },
    inactive: { label: 'Inativo', color: '#94a3b8', bg: '#1a2736' },
    blocked: { label: 'Bloqueado', color: '#ff5252', bg: '#2b0d0d' },
}

export default function ConfiguracoesPage() {
    const router = useRouter()
    const supabase = createClient()

    const [companyId, setCompanyId] = useState('')
    const [isSuperAdmin, setIsSuperAdmin] = useState(false)
    const [aba, setAba] = useState<'bases' | 'clientes' | 'funcionarios' | 'motoristas'>('bases')

    // Bases
    const [bases, setBases] = useState<Base[]>([])
    const [nomeBase, setNomeBase] = useState('')
    const [codigoBase, setCodigoBase] = useState('')
    const [salvandoBase, setSalvandoBase] = useState(false)

    // Clientes
    const [clientes, setClientes] = useState<Cliente[]>([])
    const [nomeCliente, setNomeCliente] = useState('')
    const [codigoCliente, setCodigoCliente] = useState('')
    const [baseClienteId, setBaseClienteId] = useState('')
    const [salvandoCliente, setSalvandoCliente] = useState(false)

    // Funcionários
    const [funcionarios, setFuncionarios] = useState<Funcionario[]>([])
    const [editandoFunc, setEditandoFunc] = useState<string | null>(null)
    const [permissoesEdit, setPermissoesEdit] = useState<Record<string, boolean>>({})
    const [cargoEdit, setCargoEdit] = useState('')
    const [salvandoFunc, setSalvandoFunc] = useState(false)

    // Motoristas
    const [motoristas, setMotoristas] = useState<Motorista[]>([])
    const [editandoMot, setEditandoMot] = useState<string | null>(null)
    const [motivoBloqueio, setMotivoBloqueio] = useState('')
    const [filtroStatus, setFiltroStatus] = useState<'todos' | 'active' | 'inactive' | 'blocked'>('todos')
    const [salvandoMot, setSalvandoMot] = useState(false)

    const [erro, setErro] = useState('')
    const [sucesso, setSucesso] = useState('')

    useEffect(() => {
        async function init() {
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) { router.push('/login'); return }

            const { data: userData } = await supabase
                .from('users').select('company_id, cargo').eq('id', user.id).single()
            if (!userData) return

            const isSA = userData.cargo === 'super_admin' || userData.cargo === 'admin'
            setIsSuperAdmin(isSA)
            setCompanyId(userData.company_id)
            setBaseClienteId(userData.company_id)

            await Promise.all([
                carregarBases(),
                carregarClientes(userData.company_id),
                carregarFuncionarios(userData.company_id),
                carregarMotoristas(userData.company_id),
            ])
        }
        init()
    }, [])

    async function carregarBases() {
        const { data } = await supabase.from('companies').select('*').order('name')
        setBases(data || [])
    }

    async function carregarClientes(cid: string) {
        const { data } = await supabase.from('clients').select('*')
            .eq('company_id', cid).order('name')
        setClientes(data || [])
    }

    async function carregarFuncionarios(cid: string) {
        const { data } = await supabase.from('users').select('*')
            .eq('company_id', cid).order('name')
        setFuncionarios(data || [])
    }

    async function carregarMotoristas(cid: string) {
        const { data } = await supabase.from('drivers').select('*')
            .eq('company_id', cid).order('name')
        setMotoristas(data || [])
    }

    function msg(tipo: 'ok' | 'erro', texto: string) {
        if (tipo === 'ok') { setSucesso(texto); setTimeout(() => setSucesso(''), 3000) }
        else { setErro(texto); setTimeout(() => setErro(''), 3000) }
    }

    // ── BASES ──
    async function adicionarBase() {
        if (!nomeBase.trim()) { msg('erro', 'Nome obrigatório'); return }
        setSalvandoBase(true)
        const { error } = await supabase.from('companies').insert({
            name: nomeBase.trim(),
            code: codigoBase.trim().toUpperCase() || null,
            active: true
        })
        if (error) msg('erro', 'Erro ao salvar base')
        else { msg('ok', 'Base adicionada'); setNomeBase(''); setCodigoBase(''); await carregarBases() }
        setSalvandoBase(false)
    }

    async function toggleBase(id: string, ativo: boolean) {
        await supabase.from('companies').update({ active: !ativo }).eq('id', id)
        await carregarBases()
    }

    // ── CLIENTES ──
    async function adicionarCliente() {
        if (!nomeCliente.trim()) { msg('erro', 'Nome obrigatório'); return }
        setSalvandoCliente(true)
        const { error } = await supabase.from('clients').insert({
            company_id: baseClienteId,
            name: nomeCliente.trim(),
            code: codigoCliente.trim().toUpperCase() || null,
            active: true
        })
        if (error) msg('erro', 'Erro ao salvar cliente')
        else { msg('ok', 'Cliente adicionado'); setNomeCliente(''); setCodigoCliente(''); await carregarClientes(companyId) }
        setSalvandoCliente(false)
    }

    async function toggleCliente(id: string, ativo: boolean) {
        await supabase.from('clients').update({ active: !ativo }).eq('id', id)
        await carregarClientes(companyId)
    }

    // ── FUNCIONÁRIOS ──
    function abrirEdicaoFunc(func: Funcionario) {
        setEditandoFunc(func.id)
        setCargoEdit(func.cargo)
        setPermissoesEdit(func.permissoes || {})
    }

    async function salvarFunc() {
        if (!editandoFunc) return
        setSalvandoFunc(true)
        await supabase.from('users').update({
            cargo: cargoEdit,
            permissoes: permissoesEdit
        }).eq('id', editandoFunc)
        msg('ok', 'Funcionário atualizado')
        setEditandoFunc(null)
        setSalvandoFunc(false)
        await carregarFuncionarios(companyId)
    }

    async function toggleFuncionario(id: string, ativo: boolean) {
        await supabase.from('users').update({ active: !ativo }).eq('id', id)
        await carregarFuncionarios(companyId)
    }

    // ── MOTORISTAS ──
    async function alterarStatusMotorista(mot: Motorista, novoStatus: string) {
        if (novoStatus === 'blocked' && !motivoBloqueio.trim()) {
            msg('erro', 'Informe o motivo do bloqueio')
            return
        }
        setSalvandoMot(true)
        await supabase.from('drivers').update({
            status: novoStatus,
            active: novoStatus === 'active',
            blocked_reason: novoStatus === 'blocked' ? motivoBloqueio.trim() : null
        }).eq('id', mot.id)
        msg('ok', 'Status atualizado')
        setEditandoMot(null)
        setMotivoBloqueio('')
        setSalvandoMot(false)
        await carregarMotoristas(companyId)
    }

    const motoristasFiltrados = motoristas.filter(m =>
        filtroStatus === 'todos' ? true : m.status === filtroStatus
    )

    const kpisMotoristas = {
        ativos: motoristas.filter(m => m.status === 'active').length,
        inativos: motoristas.filter(m => m.status === 'inactive').length,
        bloqueados: motoristas.filter(m => m.status === 'blocked').length,
    }

    return (
        <main className="min-h-screen p-6" style={{ backgroundColor: '#0f1923' }}>
            <div className="max-w-3xl mx-auto">
                <button onClick={() => router.push('/dashboard')}
                    className="text-slate-400 text-sm mb-6 hover:text-white">← Voltar</button>

                <h1 className="text-white font-black tracking-widest uppercase text-xl mb-6">
                    ⚙️ Configurações
                </h1>

                {/* Mensagens */}
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

                {/* Abas */}
                <div className="flex gap-2 mb-6 flex-wrap">
                    {[
                        { key: 'bases', label: `Bases (${bases.length})` },
                        { key: 'clientes', label: `Clientes (${clientes.length})` },
                        { key: 'funcionarios', label: `Funcionários (${funcionarios.length})` },
                        { key: 'motoristas', label: `Motoristas (${motoristas.length})` },
                    ].map(a => (
                        <button key={a.key} onClick={() => setAba(a.key as any)}
                            className="px-5 py-2 rounded font-black tracking-widest uppercase text-sm outline-none"
                            style={{ backgroundColor: aba === a.key ? '#00b4b4' : '#1a2736', color: 'white' }}>
                            {a.label}
                        </button>
                    ))}
                </div>

                {/* ─── BASES ─── */}
                {aba === 'bases' && (
                    <div className="flex flex-col gap-4">
                        <div className="rounded-lg p-5" style={{ backgroundColor: '#1a2736' }}>
                            <p className="text-xs font-bold tracking-widest uppercase text-slate-400 mb-4">Nova Base</p>
                            <div className="flex flex-col gap-3">
                                <input value={nomeBase} onChange={e => setNomeBase(e.target.value)}
                                    placeholder="Nome da base (ex: DeLuna Caxias)"
                                    className="px-4 py-3 rounded text-white text-sm outline-none"
                                    style={{ backgroundColor: '#0f1923', border: '1px solid #2a3f52' }} />
                                <input value={codigoBase} onChange={e => setCodigoBase(e.target.value.toUpperCase())}
                                    placeholder="Código (ex: SGO9)"
                                    className="px-4 py-3 rounded text-white text-sm outline-none"
                                    style={{ backgroundColor: '#0f1923', border: '1px solid #2a3f52' }} />
                                <button onClick={adicionarBase} disabled={salvandoBase}
                                    className="py-3 rounded font-black tracking-widest uppercase text-white text-sm disabled:opacity-50"
                                    style={{ backgroundColor: '#00b4b4' }}>
                                    {salvandoBase ? 'Salvando...' : 'Adicionar Base'}
                                </button>
                            </div>
                        </div>

                        <div className="rounded-lg p-5" style={{ backgroundColor: '#1a2736' }}>
                            <p className="text-xs font-bold tracking-widest uppercase text-slate-400 mb-4">
                                Bases Cadastradas — {bases.length}
                            </p>
                            <div className="flex flex-col gap-2">
                                {bases.map(b => (
                                    <div key={b.id} className="flex items-center justify-between p-3 rounded"
                                        style={{ backgroundColor: '#0f1923' }}>
                                        <div>
                                            <p className="text-white font-bold text-sm">{b.name}</p>
                                            {b.code && <p className="text-slate-400 text-xs">{b.code}</p>}
                                        </div>
                                        <button onClick={() => toggleBase(b.id, b.active)}
                                            className="px-3 py-1 rounded text-xs font-bold tracking-widest uppercase"
                                            style={{
                                                backgroundColor: b.active ? '#0d2b1a' : '#2b0d0d',
                                                color: b.active ? '#00e676' : '#ff5252',
                                                border: `1px solid ${b.active ? '#00e676' : '#ff5252'}`
                                            }}>
                                            {b.active ? 'Ativa' : 'Inativa'}
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                )}

                {/* ─── CLIENTES ─── */}
                {aba === 'clientes' && (
                    <div className="flex flex-col gap-4">
                        <div className="rounded-lg p-5" style={{ backgroundColor: '#1a2736' }}>
                            <p className="text-xs font-bold tracking-widest uppercase text-slate-400 mb-4">Novo Cliente</p>
                            <div className="flex flex-col gap-3">
                                {isSuperAdmin && (
                                    <select value={baseClienteId} onChange={e => { setBaseClienteId(e.target.value); carregarClientes(e.target.value) }}
                                        className="px-4 py-3 rounded text-white text-sm outline-none"
                                        style={{ backgroundColor: '#0f1923', border: '1px solid #2a3f52' }}>
                                        {bases.filter(b => b.active).map(b => (
                                            <option key={b.id} value={b.id}>{b.code ? `${b.code} — ` : ''}{b.name}</option>
                                        ))}
                                    </select>
                                )}
                                <input value={nomeCliente} onChange={e => setNomeCliente(e.target.value)}
                                    placeholder="Nome do cliente (ex: Amazon)"
                                    className="px-4 py-3 rounded text-white text-sm outline-none"
                                    style={{ backgroundColor: '#0f1923', border: '1px solid #2a3f52' }} />
                                <input value={codigoCliente} onChange={e => setCodigoCliente(e.target.value.toUpperCase())}
                                    placeholder="Código (ex: AMZ)"
                                    className="px-4 py-3 rounded text-white text-sm outline-none"
                                    style={{ backgroundColor: '#0f1923', border: '1px solid #2a3f52' }} />
                                <button onClick={adicionarCliente} disabled={salvandoCliente}
                                    className="py-3 rounded font-black tracking-widest uppercase text-white text-sm disabled:opacity-50"
                                    style={{ backgroundColor: '#00b4b4' }}>
                                    {salvandoCliente ? 'Salvando...' : 'Adicionar Cliente'}
                                </button>
                            </div>
                        </div>

                        <div className="rounded-lg p-5" style={{ backgroundColor: '#1a2736' }}>
                            <p className="text-xs font-bold tracking-widest uppercase text-slate-400 mb-4">
                                Clientes Cadastrados — {clientes.length}
                            </p>
                            <div className="flex flex-col gap-2">
                                {clientes.map(c => (
                                    <div key={c.id} className="flex items-center justify-between p-3 rounded"
                                        style={{ backgroundColor: '#0f1923' }}>
                                        <div>
                                            <p className="text-white font-bold text-sm">{c.name}</p>
                                            {c.code && <p className="text-slate-400 text-xs">{c.code}</p>}
                                        </div>
                                        <button onClick={() => toggleCliente(c.id, c.active)}
                                            className="px-3 py-1 rounded text-xs font-bold tracking-widest uppercase"
                                            style={{
                                                backgroundColor: c.active ? '#0d2b1a' : '#2b0d0d',
                                                color: c.active ? '#00e676' : '#ff5252',
                                                border: `1px solid ${c.active ? '#00e676' : '#ff5252'}`
                                            }}>
                                            {c.active ? 'Ativo' : 'Inativo'}
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                )}

                {/* ─── FUNCIONÁRIOS ─── */}
                {aba === 'funcionarios' && (
                    <div className="flex flex-col gap-4">
                        <div className="rounded-lg p-4"
                            style={{ backgroundColor: '#2b1f0d', border: '1px solid #ffb300' }}>
                            <p className="text-xs font-bold tracking-widest uppercase mb-1" style={{ color: '#ffb300' }}>
                                Como adicionar funcionários
                            </p>
                            <p className="text-slate-400 text-xs leading-relaxed">
                                Vá em <strong className="text-white">Supabase → Authentication → Users → Add User</strong>,
                                crie com email e senha. Na primeira vez que fizer login, aparecerá aqui automaticamente.
                            </p>
                        </div>

                        <div className="flex flex-col gap-3">
                            {funcionarios.map(func => (
                                <div key={func.id} className="rounded-lg overflow-hidden"
                                    style={{ backgroundColor: '#1a2736' }}>
                                    <div className="flex items-center justify-between p-4">
                                        <div>
                                            <p className="text-white font-bold">{func.name}</p>
                                            <p className="text-slate-400 text-xs capitalize">{func.cargo}</p>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <button onClick={() => toggleFuncionario(func.id, func.active)}
                                                className="px-3 py-1 rounded text-xs font-bold"
                                                style={{
                                                    backgroundColor: func.active ? '#0d2b1a' : '#2b0d0d',
                                                    color: func.active ? '#00e676' : '#ff5252',
                                                    border: `1px solid ${func.active ? '#00e676' : '#ff5252'}`
                                                }}>
                                                {func.active ? 'Ativo' : 'Inativo'}
                                            </button>
                                            <button
                                                onClick={() => editandoFunc === func.id ? setEditandoFunc(null) : abrirEdicaoFunc(func)}
                                                className="px-3 py-1 rounded text-xs font-bold"
                                                style={{ backgroundColor: '#0f1923', color: '#00b4b4', border: '1px solid #00b4b4' }}>
                                                {editandoFunc === func.id ? 'Fechar' : 'Editar'}
                                            </button>
                                        </div>
                                    </div>

                                    {editandoFunc === func.id && (
                                        <div className="px-4 pb-4 flex flex-col gap-4 border-t"
                                            style={{ borderColor: '#0f1923' }}>
                                            <div className="mt-3">
                                                <label className="text-xs font-bold tracking-widest uppercase text-slate-400 mb-2 block">
                                                    Cargo
                                                </label>
                                                <select value={cargoEdit} onChange={e => setCargoEdit(e.target.value)}
                                                    className="w-full px-4 py-2 rounded text-white text-sm outline-none"
                                                    style={{ backgroundColor: '#0f1923', border: '1px solid #2a3f52' }}>
                                                    {cargos.map(c => (
                                                        <option key={c} value={c}>{c}</option>
                                                    ))}
                                                </select>
                                            </div>

                                            <div>
                                                <label className="text-xs font-bold tracking-widest uppercase text-slate-400 mb-2 block">
                                                    Permissões de Módulos
                                                </label>
                                                <div className="grid grid-cols-2 gap-2">
                                                    {modulos.map(m => (
                                                        <button key={m.key}
                                                            onClick={() => setPermissoesEdit(prev => ({
                                                                ...prev, [m.key]: !prev[m.key]
                                                            }))}
                                                            className="flex items-center gap-2 px-3 py-2 rounded text-xs font-bold text-left"
                                                            style={{
                                                                backgroundColor: permissoesEdit[m.key] ? '#0d2b1a' : '#0f1923',
                                                                color: permissoesEdit[m.key] ? '#00e676' : '#94a3b8',
                                                                border: `1px solid ${permissoesEdit[m.key] ? '#00e676' : '#2a3f52'}`
                                                            }}>
                                                            {permissoesEdit[m.key] ? '✅' : '⬜'} {m.label}
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>

                                            <button onClick={salvarFunc} disabled={salvandoFunc}
                                                className="py-2 rounded font-black tracking-widest uppercase text-white text-sm disabled:opacity-50"
                                                style={{ backgroundColor: '#00b4b4' }}>
                                                {salvandoFunc ? 'Salvando...' : 'Salvar Alterações'}
                                            </button>
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* ─── MOTORISTAS ─── */}
                {aba === 'motoristas' && (
                    <div className="flex flex-col gap-4">

                        {/* KPIs */}
                        <div className="grid grid-cols-3 gap-3">
                            {[
                                { label: 'Ativos', value: kpisMotoristas.ativos, color: '#00e676', bg: '#0d2b1a', filtro: 'active' },
                                { label: 'Inativos', value: kpisMotoristas.inativos, color: '#94a3b8', bg: '#1a2736', filtro: 'inactive' },
                                { label: 'Bloqueados', value: kpisMotoristas.bloqueados, color: '#ff5252', bg: '#2b0d0d', filtro: 'blocked' },
                            ].map(k => (
                                <button key={k.filtro}
                                    onClick={() => setFiltroStatus(filtroStatus === k.filtro ? 'todos' : k.filtro as any)}
                                    className="rounded-lg p-4 text-center outline-none"
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

                        {/* Lista */}
                        <div className="flex flex-col gap-3">
                            {motoristasFiltrados.length === 0 ? (
                                <div className="rounded-lg p-8 text-center" style={{ backgroundColor: '#1a2736' }}>
                                    <p className="text-slate-400">Nenhum motorista encontrado</p>
                                </div>
                            ) : motoristasFiltrados.map(mot => (
                                <div key={mot.id} className="rounded-lg overflow-hidden"
                                    style={{ backgroundColor: '#1a2736' }}>
                                    <div className="flex items-center justify-between p-4">
                                        <div>
                                            <p className="text-white font-bold">{mot.name}</p>
                                            <p className="text-slate-400 text-xs">
                                                {mot.license_plate} · {mot.vehicle_type}
                                                {mot.cpf && ` · CPF: ${mot.cpf}`}
                                            </p>
                                            {mot.status === 'blocked' && mot.blocked_reason && (
                                                <p className="text-xs mt-1" style={{ color: '#ff5252' }}>
                                                    🚫 {mot.blocked_reason}
                                                </p>
                                            )}
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <span className="px-2 py-1 rounded text-xs font-bold"
                                                style={{
                                                    backgroundColor: statusMotorista[mot.status]?.bg,
                                                    color: statusMotorista[mot.status]?.color,
                                                    border: `1px solid ${statusMotorista[mot.status]?.color}`
                                                }}>
                                                {statusMotorista[mot.status]?.label}
                                            </span>
                                            <button
                                                onClick={() => editandoMot === mot.id ? setEditandoMot(null) : setEditandoMot(mot.id)}
                                                className="px-3 py-1 rounded text-xs font-bold"
                                                style={{ backgroundColor: '#0f1923', color: '#00b4b4', border: '1px solid #00b4b4' }}>
                                                {editandoMot === mot.id ? 'Fechar' : 'Gerenciar'}
                                            </button>
                                        </div>
                                    </div>

                                    {editandoMot === mot.id && (
                                        <div className="px-4 pb-4 border-t flex flex-col gap-3"
                                            style={{ borderColor: '#0f1923' }}>
                                            <p className="text-xs font-bold tracking-widest uppercase text-slate-400 mt-3">
                                                Alterar Status
                                            </p>
                                            <div className="flex gap-2 flex-wrap">
                                                {['active', 'inactive', 'blocked'].map(s => (
                                                    <button key={s}
                                                        onClick={() => s !== 'blocked' && alterarStatusMotorista(mot, s)}
                                                        className="px-3 py-2 rounded text-xs font-bold tracking-widest uppercase"
                                                        style={{
                                                            backgroundColor: mot.status === s
                                                                ? statusMotorista[s]?.bg
                                                                : '#0f1923',
                                                            color: statusMotorista[s]?.color,
                                                            border: `1px solid ${statusMotorista[s]?.color}`,
                                                            opacity: s === 'blocked' ? 1 : 1
                                                        }}>
                                                        {statusMotorista[s]?.label}
                                                    </button>
                                                ))}
                                            </div>

                                            {/* Bloqueio com motivo */}
                                            <div className="flex flex-col gap-2">
                                                <label className="text-xs font-bold tracking-widest uppercase text-slate-400">
                                                    Motivo do Bloqueio
                                                </label>
                                                <input value={motivoBloqueio}
                                                    onChange={e => setMotivoBloqueio(e.target.value)}
                                                    placeholder="Ex: Documentos vencidos, má conduta..."
                                                    className="px-4 py-2 rounded text-white text-sm outline-none"
                                                    style={{ backgroundColor: '#0f1923', border: '1px solid #2a3f52' }} />
                                                <button
                                                    onClick={() => alterarStatusMotorista(mot, 'blocked')}
                                                    disabled={salvandoMot || !motivoBloqueio.trim()}
                                                    className="py-2 rounded font-black tracking-widest uppercase text-white text-sm disabled:opacity-30"
                                                    style={{ backgroundColor: '#c0392b' }}>
                                                    {salvandoMot ? 'Salvando...' : '🚫 Confirmar Bloqueio'}
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </main>
    )
}