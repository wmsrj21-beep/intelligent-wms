'use client'

import { useState, useEffect } from 'react'
import { createClient } from '../lib/supabase'
import { useRouter } from 'next/navigation'

type Base = { id: string; name: string; code: string | null; active: boolean }
type Cliente = { id: string; name: string; code: string | null; active: boolean; company_id: string }
type Funcionario = {
    id: string; name: string; cargo: string; active: boolean
    company_id: string; permissoes: Record<string, boolean>; first_login: boolean
}

const HIERARQUIA: Record<string, number> = {
    super_admin: 0, admin: 1, gerente: 2, coordenador: 3,
    supervisor: 4, encarregado: 5, lider: 6, assistente: 7, auxiliar: 8
}

const cargos = Object.keys(HIERARQUIA)

const PODE_CRIAR = ['super_admin', 'admin', 'gerente']
const PODE_VER_FUNCIONARIOS = ['super_admin', 'admin', 'gerente', 'coordenador', 'supervisor', 'encarregado', 'lider']
const PODE_GERIR_BASES = ['super_admin', 'admin', 'gerente', 'coordenador', 'supervisor', 'encarregado', 'lider']

const modulos = [
    { key: 'recebimento', label: 'Recebimento' },
    { key: 'armazem', label: 'Armazém' },
    { key: 'expedicao', label: 'Expedição' },
    { key: 'patio', label: 'Pátio' },
    { key: 'rastrear', label: 'Rastrear' },
    { key: 'rua', label: 'Rua' },
    { key: 'inventario', label: 'Inventário' },
    { key: 'localizar', label: 'Localizar' },
    { key: 'retorno', label: 'Retorno de Rua' },
    { key: 'motoristas', label: 'Motoristas' },
    { key: 'devolucao', label: 'Devolução' },
    { key: 'configuracoes', label: 'Configurações' },
]

export default function ConfiguracoesPage() {
    const router = useRouter()
    const supabase = createClient()

    const [companyId, setCompanyId] = useState('')
    const [userId, setUserId] = useState('')
    const [userName, setUserName] = useState('')
    const [cargo, setCargo] = useState('')
    const [aba, setAba] = useState<'conta' | 'bases' | 'clientes' | 'funcionarios'>('conta')

    const meuNivel = HIERARQUIA[cargo] ?? 99
    const podeCriarFunc = PODE_CRIAR.includes(cargo)
    const podeVerFuncionarios = PODE_VER_FUNCIONARIOS.includes(cargo)
    const podeGerirBases = PODE_GERIR_BASES.includes(cargo)
    const isSuperAdmin = cargo === 'super_admin'

    function podeEditarFunc(funcCargo: string): boolean {
        return (HIERARQUIA[funcCargo] ?? 99) > meuNivel
    }

    const [bases, setBases] = useState<Base[]>([])
    const [nomeBase, setNomeBase] = useState('')
    const [codigoBase, setCodigoBase] = useState('')
    const [editandoBase, setEditandoBase] = useState<Base | null>(null)
    const [salvandoBase, setSalvandoBase] = useState(false)

    const [clientes, setClientes] = useState<Cliente[]>([])
    const [nomeCliente, setNomeCliente] = useState('')
    const [codigoCliente, setCodigoCliente] = useState('')
    const [baseClienteId, setBaseClienteId] = useState('')
    const [editandoCliente, setEditandoCliente] = useState<Cliente | null>(null)
    const [salvandoCliente, setSalvandoCliente] = useState(false)

    const [funcionarios, setFuncionarios] = useState<Funcionario[]>([])
    const [editandoFunc, setEditandoFunc] = useState<string | null>(null)
    const [permissoesEdit, setPermissoesEdit] = useState<Record<string, boolean>>({})
    const [cargoEdit, setCargoEdit] = useState('')
    const [salvandoFunc, setSalvandoFunc] = useState(false)

    const [novoNome, setNovoNome] = useState('')
    const [novoEmail, setNovoEmail] = useState('')
    const [novoCargo, setNovoCargo] = useState('auxiliar')
    const [novasBases, setNovasBases] = useState<string[]>([])
    const [novasPermissoes, setNovasPermissoes] = useState<Record<string, boolean>>({})
    const [criandoFunc, setCriandoFunc] = useState(false)
    const [mostrarFormFunc, setMostrarFormFunc] = useState(false)

    const [novaSenha, setNovaSenha] = useState('')
    const [confirmarSenha, setConfirmarSenha] = useState('')
    const [salvandoSenha, setSalvandoSenha] = useState(false)

    const [resetando, setResetando] = useState(false)
    const [erro, setErro] = useState('')
    const [sucesso, setSucesso] = useState('')

    useEffect(() => {
        async function init() {
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) { router.push('/login'); return }
            setUserId(user.id)

            const { data: userData } = await supabase
                .from('users').select('company_id, cargo, name').eq('id', user.id).single()
            if (!userData) return

            setCargo(userData.cargo)
            setCompanyId(userData.company_id)
            setUserName(userData.name)
            setBaseClienteId(userData.company_id)

            await Promise.all([
                carregarBases(),
                carregarClientes(userData.company_id),
                PODE_VER_FUNCIONARIOS.includes(userData.cargo)
                    ? carregarFuncionarios(userData.company_id)
                    : Promise.resolve(),
            ])
        }
        init()
    }, [])

    async function carregarBases() {
        const { data } = await supabase.from('companies').select('*').order('name')
        setBases(data || [])
    }

    async function carregarClientes(cid: string) {
        const { data } = await supabase.from('clients').select('*').eq('company_id', cid).order('name')
        setClientes(data || [])
    }

    async function carregarFuncionarios(cid: string) {
        const { data } = await supabase.from('users').select('*').eq('company_id', cid).order('name')
        setFuncionarios(data || [])
    }

    function msg(tipo: 'ok' | 'erro', texto: string) {
        if (tipo === 'ok') { setSucesso(texto); setTimeout(() => setSucesso(''), 4000) }
        else { setErro(texto); setTimeout(() => setErro(''), 4000) }
    }

    async function trocarSenha() {
        if (novaSenha.length < 6) { msg('erro', 'Senha deve ter pelo menos 6 caracteres'); return }
        if (novaSenha !== confirmarSenha) { msg('erro', 'As senhas não coincidem'); return }
        if (novaSenha === 'Teste@123') { msg('erro', 'Escolha uma senha diferente da senha padrão'); return }
        setSalvandoSenha(true)
        const { error } = await supabase.auth.updateUser({ password: novaSenha })
        if (error) msg('erro', 'Erro ao atualizar senha')
        else { msg('ok', 'Senha atualizada!'); setNovaSenha(''); setConfirmarSenha('') }
        setSalvandoSenha(false)
    }

    async function salvarBase() {
        if (!nomeBase.trim()) { msg('erro', 'Nome obrigatório'); return }
        setSalvandoBase(true)
        if (editandoBase) {
            const { error } = await supabase.from('companies').update({
                name: nomeBase.trim(), code: codigoBase.trim().toUpperCase() || null,
            }).eq('id', editandoBase.id)
            if (error) msg('erro', 'Erro ao atualizar base')
            else { msg('ok', 'Base atualizada'); setEditandoBase(null) }
        } else {
            const { error } = await supabase.from('companies').insert({
                name: nomeBase.trim(), code: codigoBase.trim().toUpperCase() || null, active: true
            })
            if (error) msg('erro', 'Erro ao salvar base')
            else msg('ok', 'Base adicionada')
        }
        setNomeBase(''); setCodigoBase(''); setSalvandoBase(false)
        await carregarBases()
    }

    function iniciarEdicaoBase(base: Base) { setEditandoBase(base); setNomeBase(base.name); setCodigoBase(base.code || '') }
    function cancelarEdicaoBase() { setEditandoBase(null); setNomeBase(''); setCodigoBase('') }

    async function toggleBase(id: string, ativo: boolean) {
        await supabase.from('companies').update({ active: !ativo }).eq('id', id)
        await carregarBases()
    }

    async function excluirBase(id: string) {
        if (!window.confirm('Tem certeza?')) return
        const { error } = await supabase.from('companies').delete().eq('id', id)
        if (error) msg('erro', 'Não é possível excluir — desative-a.')
        else { msg('ok', 'Base excluída'); await carregarBases() }
    }

    async function salvarCliente() {
        if (!nomeCliente.trim()) { msg('erro', 'Nome obrigatório'); return }
        setSalvandoCliente(true)
        if (editandoCliente) {
            const { error } = await supabase.from('clients').update({
                name: nomeCliente.trim(), code: codigoCliente.trim().toUpperCase() || null,
            }).eq('id', editandoCliente.id)
            if (error) msg('erro', 'Erro ao atualizar cliente')
            else { msg('ok', 'Cliente atualizado'); setEditandoCliente(null) }
        } else {
            const { error } = await supabase.from('clients').insert({
                company_id: baseClienteId, name: nomeCliente.trim(),
                code: codigoCliente.trim().toUpperCase() || null, active: true
            })
            if (error) msg('erro', 'Erro ao salvar cliente')
            else msg('ok', 'Cliente adicionado')
        }
        setNomeCliente(''); setCodigoCliente(''); setSalvandoCliente(false)
        await carregarClientes(baseClienteId)
    }

    function iniciarEdicaoCliente(c: Cliente) { setEditandoCliente(c); setNomeCliente(c.name); setCodigoCliente(c.code || '') }
    function cancelarEdicaoCliente() { setEditandoCliente(null); setNomeCliente(''); setCodigoCliente('') }

    async function toggleCliente(id: string, ativo: boolean) {
        await supabase.from('clients').update({ active: !ativo }).eq('id', id)
        await carregarClientes(baseClienteId)
    }

    async function excluirCliente(id: string) {
        if (!window.confirm('Tem certeza?')) return
        const { error } = await supabase.from('clients').delete().eq('id', id)
        if (error) msg('erro', 'Não é possível excluir — desative-o.')
        else { msg('ok', 'Cliente excluído'); await carregarClientes(baseClienteId) }
    }

    async function criarFuncionario() {
        if (!novoNome.trim() || !novoEmail.trim()) { msg('erro', 'Nome e email obrigatórios'); return }
        setCriandoFunc(true)
        const res = await fetch('/api/admin/create-user', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email: novoEmail.trim(), name: novoNome.trim(), cargo: novoCargo,
                company_id: companyId,
                bases_ids: novasBases.length > 0 ? novasBases : [companyId],
                permissoes: novasPermissoes
            })
        })
        const data = await res.json()
        if (!res.ok || data.error) msg('erro', data.error || 'Erro ao criar funcionário')
        else {
            msg('ok', 'Funcionário criado! Senha padrão: Teste@123')
            setNovoNome(''); setNovoEmail(''); setNovoCargo('auxiliar')
            setNovasBases([]); setNovasPermissoes({}); setMostrarFormFunc(false)
            await carregarFuncionarios(companyId)
        }
        setCriandoFunc(false)
    }

    function abrirEdicaoFunc(func: Funcionario) {
        setEditandoFunc(func.id); setCargoEdit(func.cargo); setPermissoesEdit(func.permissoes || {})
    }

    async function salvarFunc() {
        if (!editandoFunc) return
        setSalvandoFunc(true)
        const update: any = { permissoes: permissoesEdit }
        if (podeCriarFunc) update.cargo = cargoEdit
        await supabase.from('users').update(update).eq('id', editandoFunc)
        msg('ok', 'Funcionário atualizado')
        setEditandoFunc(null); setSalvandoFunc(false)
        await carregarFuncionarios(companyId)
    }

    async function toggleFuncionario(id: string, ativo: boolean, funcCargo: string) {
        if (!podeEditarFunc(funcCargo)) return
        await supabase.from('users').update({ active: !ativo }).eq('id', id)
        await carregarFuncionarios(companyId)
    }

    async function resetarDados() {
        if (!window.confirm('⚠️ ATENÇÃO: Apaga TODOS os pacotes, eventos, incidentes, inventários, devoluções, motoristas e clientes. Tem certeza?')) return
        if (!window.confirm('Esta ação é IRREVERSÍVEL. Confirma?')) return
        setResetando(true)
        try {
            const res = await fetch('/api/admin/reset', { method: 'POST' })
            const data = await res.json()
            if (!res.ok || data.error) msg('erro', data.error || 'Erro ao resetar')
            else msg('ok', 'Sistema resetado com sucesso!')
        } catch { msg('erro', 'Erro ao executar reset') }
        setResetando(false)
    }

    const cargosDisponiveis = cargos.filter(c => HIERARQUIA[c] > meuNivel)

    const abasVisiveis = [
        { key: 'conta', label: 'Minha Conta' },
        ...(podeGerirBases ? [
            { key: 'bases', label: `Bases (${bases.length})` },
            { key: 'clientes', label: `Clientes (${clientes.length})` },
        ] : []),
        ...(podeVerFuncionarios ? [{ key: 'funcionarios', label: `Funcionários (${funcionarios.length})` }] : []),
    ]

    return (
        <main className="min-h-screen p-6" style={{ backgroundColor: '#0f1923' }}>
            <div className="max-w-3xl mx-auto">
                <button onClick={() => router.push('/dashboard')}
                    className="text-slate-400 text-sm mb-6 hover:text-white">← Voltar</button>
                <h1 className="text-white font-black tracking-widest uppercase text-xl mb-6">⚙️ Configurações</h1>

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

                <div className="flex gap-2 mb-6 flex-wrap">
                    {abasVisiveis.map(a => (
                        <button key={a.key} onClick={() => setAba(a.key as any)}
                            className="px-5 py-2 rounded font-black tracking-widest uppercase text-sm outline-none"
                            style={{ backgroundColor: aba === a.key ? '#00b4b4' : '#1a2736', color: 'white' }}>
                            {a.label}
                        </button>
                    ))}
                </div>

                {/* ─── MINHA CONTA ─── */}
                {aba === 'conta' && (
                    <div className="flex flex-col gap-4">
                        <div className="rounded-lg p-5" style={{ backgroundColor: '#1a2736' }}>
                            <p className="text-xs font-bold tracking-widest uppercase text-slate-400 mb-3">Dados da Conta</p>
                            <p className="text-white font-bold">{userName}</p>
                            <p className="text-slate-400 text-xs capitalize mt-1">{cargo}</p>
                        </div>
                        <div className="rounded-lg p-5" style={{ backgroundColor: '#1a2736' }}>
                            <p className="text-xs font-bold tracking-widest uppercase text-slate-400 mb-4">Trocar Senha</p>
                            <div className="flex flex-col gap-3">
                                <input type="password" value={novaSenha} onChange={e => setNovaSenha(e.target.value)}
                                    placeholder="Nova senha (mín. 6 caracteres)"
                                    className="px-4 py-3 rounded text-white text-sm outline-none"
                                    style={{ backgroundColor: '#0f1923', border: '1px solid #2a3f52' }} />
                                <input type="password" value={confirmarSenha} onChange={e => setConfirmarSenha(e.target.value)}
                                    placeholder="Confirmar nova senha"
                                    className="px-4 py-3 rounded text-white text-sm outline-none"
                                    style={{ backgroundColor: '#0f1923', border: '1px solid #2a3f52' }} />
                                <button onClick={trocarSenha} disabled={salvandoSenha}
                                    className="py-3 rounded font-black tracking-widest uppercase text-white text-sm disabled:opacity-50"
                                    style={{ backgroundColor: '#00b4b4' }}>
                                    {salvandoSenha ? 'Salvando...' : 'Atualizar Senha'}
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* ─── BASES ─── */}
                {aba === 'bases' && podeGerirBases && (
                    <div className="flex flex-col gap-4">
                        <div className="rounded-lg p-5" style={{ backgroundColor: '#1a2736' }}>
                            <p className="text-xs font-bold tracking-widest uppercase text-slate-400 mb-4">
                                {editandoBase ? `Editando: ${editandoBase.name}` : 'Nova Base'}
                            </p>
                            <div className="flex flex-col gap-3">
                                <input value={nomeBase} onChange={e => setNomeBase(e.target.value)} placeholder="Nome da base"
                                    className="px-4 py-3 rounded text-white text-sm outline-none"
                                    style={{ backgroundColor: '#0f1923', border: '1px solid #2a3f52' }} />
                                <input value={codigoBase} onChange={e => setCodigoBase(e.target.value.toUpperCase())} placeholder="Código (ex: SGO9)"
                                    className="px-4 py-3 rounded text-white text-sm outline-none"
                                    style={{ backgroundColor: '#0f1923', border: '1px solid #2a3f52' }} />
                                <div className="flex gap-2">
                                    <button onClick={salvarBase} disabled={salvandoBase}
                                        className="flex-1 py-3 rounded font-black tracking-widest uppercase text-white text-sm disabled:opacity-50"
                                        style={{ backgroundColor: '#00b4b4' }}>
                                        {salvandoBase ? 'Salvando...' : editandoBase ? 'Salvar Edição' : 'Adicionar Base'}
                                    </button>
                                    {editandoBase && (
                                        <button onClick={cancelarEdicaoBase}
                                            className="px-4 py-3 rounded font-black tracking-widest uppercase text-white text-sm"
                                            style={{ backgroundColor: '#1a2736', border: '1px solid #2a3f52' }}>Cancelar</button>
                                    )}
                                </div>
                            </div>
                        </div>
                        <div className="rounded-lg p-5" style={{ backgroundColor: '#1a2736' }}>
                            <p className="text-xs font-bold tracking-widest uppercase text-slate-400 mb-4">Bases — {bases.length}</p>
                            <div className="flex flex-col gap-2">
                                {bases.map(b => (
                                    <div key={b.id} className="flex items-center justify-between p-3 rounded" style={{ backgroundColor: '#0f1923' }}>
                                        <div>
                                            <p className="text-white font-bold text-sm">{b.name}</p>
                                            {b.code && <p className="text-slate-400 text-xs">{b.code}</p>}
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <button onClick={() => iniciarEdicaoBase(b)} className="px-2 py-1 rounded text-xs font-bold"
                                                style={{ backgroundColor: '#0f1923', color: '#00b4b4', border: '1px solid #00b4b4' }}>Editar</button>
                                            <button onClick={() => toggleBase(b.id, b.active)} className="px-2 py-1 rounded text-xs font-bold"
                                                style={{ backgroundColor: b.active ? '#0d2b1a' : '#2b0d0d', color: b.active ? '#00e676' : '#ff5252', border: `1px solid ${b.active ? '#00e676' : '#ff5252'}` }}>
                                                {b.active ? 'Ativa' : 'Inativa'}
                                            </button>
                                            <button onClick={() => excluirBase(b.id)} className="px-2 py-1 rounded text-xs font-bold"
                                                style={{ backgroundColor: '#2b0d0d', color: '#ff5252', border: '1px solid #ff5252' }}>Excluir</button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                        {isSuperAdmin && (
                            <div className="rounded-lg p-5" style={{ backgroundColor: '#1a0d0d', border: '1px solid #ff5252' }}>
                                <p className="text-xs font-bold tracking-widest uppercase mb-1" style={{ color: '#ff5252' }}>⚠️ Zona de Perigo</p>
                                <p className="text-slate-400 text-xs mb-4">Apaga todos os dados operacionais. Usuários e bases são preservados.</p>
                                <button onClick={resetarDados} disabled={resetando}
                                    className="py-3 px-6 rounded font-black tracking-widest uppercase text-white text-sm disabled:opacity-50"
                                    style={{ backgroundColor: '#c0392b' }}>
                                    {resetando ? 'Resetando...' : '🗑️ Reset Completo do Sistema'}
                                </button>
                            </div>
                        )}
                    </div>
                )}

                {/* ─── CLIENTES ─── */}
                {aba === 'clientes' && podeGerirBases && (
                    <div className="flex flex-col gap-4">
                        <div className="rounded-lg p-5" style={{ backgroundColor: '#1a2736' }}>
                            <p className="text-xs font-bold tracking-widest uppercase text-slate-400 mb-4">
                                {editandoCliente ? `Editando: ${editandoCliente.name}` : 'Novo Cliente'}
                            </p>
                            <div className="flex flex-col gap-3">
                                {isSuperAdmin && !editandoCliente && (
                                    <select value={baseClienteId} onChange={e => { setBaseClienteId(e.target.value); carregarClientes(e.target.value) }}
                                        className="px-4 py-3 rounded text-white text-sm outline-none"
                                        style={{ backgroundColor: '#0f1923', border: '1px solid #2a3f52' }}>
                                        {bases.filter(b => b.active).map(b => (
                                            <option key={b.id} value={b.id}>{b.code ? `${b.code} — ` : ''}{b.name}</option>
                                        ))}
                                    </select>
                                )}
                                <input value={nomeCliente} onChange={e => setNomeCliente(e.target.value)} placeholder="Nome do cliente"
                                    className="px-4 py-3 rounded text-white text-sm outline-none"
                                    style={{ backgroundColor: '#0f1923', border: '1px solid #2a3f52' }} />
                                <input value={codigoCliente} onChange={e => setCodigoCliente(e.target.value.toUpperCase())} placeholder="Código (ex: AMZ)"
                                    className="px-4 py-3 rounded text-white text-sm outline-none"
                                    style={{ backgroundColor: '#0f1923', border: '1px solid #2a3f52' }} />
                                <div className="flex gap-2">
                                    <button onClick={salvarCliente} disabled={salvandoCliente}
                                        className="flex-1 py-3 rounded font-black tracking-widest uppercase text-white text-sm disabled:opacity-50"
                                        style={{ backgroundColor: '#00b4b4' }}>
                                        {salvandoCliente ? 'Salvando...' : editandoCliente ? 'Salvar Edição' : 'Adicionar Cliente'}
                                    </button>
                                    {editandoCliente && (
                                        <button onClick={cancelarEdicaoCliente}
                                            className="px-4 py-3 rounded font-black tracking-widest uppercase text-white text-sm"
                                            style={{ backgroundColor: '#1a2736', border: '1px solid #2a3f52' }}>Cancelar</button>
                                    )}
                                </div>
                            </div>
                        </div>
                        <div className="rounded-lg p-5" style={{ backgroundColor: '#1a2736' }}>
                            <p className="text-xs font-bold tracking-widest uppercase text-slate-400 mb-4">Clientes — {clientes.length}</p>
                            <div className="flex flex-col gap-2">
                                {clientes.map(c => (
                                    <div key={c.id} className="flex items-center justify-between p-3 rounded" style={{ backgroundColor: '#0f1923' }}>
                                        <div>
                                            <p className="text-white font-bold text-sm">{c.name}</p>
                                            {c.code && <p className="text-slate-400 text-xs">{c.code}</p>}
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <button onClick={() => iniciarEdicaoCliente(c)} className="px-2 py-1 rounded text-xs font-bold"
                                                style={{ backgroundColor: '#0f1923', color: '#00b4b4', border: '1px solid #00b4b4' }}>Editar</button>
                                            <button onClick={() => toggleCliente(c.id, c.active)} className="px-2 py-1 rounded text-xs font-bold"
                                                style={{ backgroundColor: c.active ? '#0d2b1a' : '#2b0d0d', color: c.active ? '#00e676' : '#ff5252', border: `1px solid ${c.active ? '#00e676' : '#ff5252'}` }}>
                                                {c.active ? 'Ativo' : 'Inativo'}
                                            </button>
                                            <button onClick={() => excluirCliente(c.id)} className="px-2 py-1 rounded text-xs font-bold"
                                                style={{ backgroundColor: '#2b0d0d', color: '#ff5252', border: '1px solid #ff5252' }}>Excluir</button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                )}

                {/* ─── FUNCIONÁRIOS ─── */}
                {aba === 'funcionarios' && podeVerFuncionarios && (
                    <div className="flex flex-col gap-4">
                        {podeCriarFunc && (
                            !mostrarFormFunc ? (
                                <button onClick={() => setMostrarFormFunc(true)}
                                    className="py-3 rounded font-black tracking-widest uppercase text-white text-sm"
                                    style={{ backgroundColor: '#00b4b4' }}>
                                    + Novo Funcionário
                                </button>
                            ) : (
                                <div className="rounded-lg p-5" style={{ backgroundColor: '#1a2736' }}>
                                    <div className="flex justify-between items-center mb-4">
                                        <p className="text-xs font-bold tracking-widest uppercase text-slate-400">Novo Funcionário</p>
                                        <button onClick={() => setMostrarFormFunc(false)} className="text-slate-400 hover:text-white text-sm">✕</button>
                                    </div>
                                    <div className="flex flex-col gap-3">
                                        <input value={novoNome} onChange={e => setNovoNome(e.target.value)} placeholder="Nome completo *"
                                            className="px-4 py-3 rounded text-white text-sm outline-none"
                                            style={{ backgroundColor: '#0f1923', border: '1px solid #2a3f52' }} />
                                        <input value={novoEmail} onChange={e => setNovoEmail(e.target.value)} placeholder="Email *" type="email"
                                            className="px-4 py-3 rounded text-white text-sm outline-none"
                                            style={{ backgroundColor: '#0f1923', border: '1px solid #2a3f52' }} />
                                        <select value={novoCargo} onChange={e => setNovoCargo(e.target.value)}
                                            className="px-4 py-3 rounded text-white text-sm outline-none"
                                            style={{ backgroundColor: '#0f1923', border: '1px solid #2a3f52' }}>
                                            {cargosDisponiveis.map(c => <option key={c} value={c}>{c}</option>)}
                                        </select>
                                        {bases.filter(b => b.active).length > 1 && (
                                            <div>
                                                <label className="text-xs font-bold tracking-widest uppercase text-slate-400 mb-2 block">Bases de Acesso</label>
                                                <div className="flex flex-col gap-1">
                                                    {bases.filter(b => b.active).map(b => (
                                                        <button key={b.id}
                                                            onClick={() => setNovasBases(prev => prev.includes(b.id) ? prev.filter(x => x !== b.id) : [...prev, b.id])}
                                                            className="flex items-center gap-2 px-3 py-2 rounded text-xs font-bold text-left outline-none"
                                                            style={{ backgroundColor: novasBases.includes(b.id) ? '#0d2b1a' : '#0f1923', color: novasBases.includes(b.id) ? '#00e676' : '#94a3b8', border: `1px solid ${novasBases.includes(b.id) ? '#00e676' : '#2a3f52'}` }}>
                                                            {novasBases.includes(b.id) ? '✅' : '⬜'} {b.code ? `${b.code} — ` : ''}{b.name}
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                        <div>
                                            <label className="text-xs font-bold tracking-widest uppercase text-slate-400 mb-2 block">Permissões de Módulos</label>
                                            <div className="grid grid-cols-2 gap-2">
                                                {modulos.map(m => (
                                                    <button key={m.key}
                                                        onClick={() => setNovasPermissoes(prev => ({ ...prev, [m.key]: !prev[m.key] }))}
                                                        className="flex items-center gap-2 px-3 py-2 rounded text-xs font-bold text-left outline-none"
                                                        style={{ backgroundColor: novasPermissoes[m.key] ? '#0d2b1a' : '#0f1923', color: novasPermissoes[m.key] ? '#00e676' : '#94a3b8', border: `1px solid ${novasPermissoes[m.key] ? '#00e676' : '#2a3f52'}` }}>
                                                        {novasPermissoes[m.key] ? '✅' : '⬜'} {m.label}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                        <div className="rounded p-3 text-xs" style={{ backgroundColor: '#0f1923', color: '#94a3b8' }}>
                                            🔑 Senha padrão: <strong className="text-white">Teste@123</strong> — obrigado a trocar no primeiro login.
                                        </div>
                                        <button onClick={criarFuncionario} disabled={criandoFunc}
                                            className="py-3 rounded font-black tracking-widest uppercase text-white text-sm disabled:opacity-50"
                                            style={{ backgroundColor: '#00b4b4' }}>
                                            {criandoFunc ? 'Criando...' : 'Criar Funcionário'}
                                        </button>
                                    </div>
                                </div>
                            )
                        )}

                        <div className="flex flex-col gap-3">
                            {funcionarios.map(func => {
                                const possoEditar = podeEditarFunc(func.cargo)
                                return (
                                    <div key={func.id} className="rounded-lg overflow-hidden" style={{ backgroundColor: '#1a2736' }}>
                                        <div className="flex items-center justify-between p-4">
                                            <div>
                                                <div className="flex items-center gap-2">
                                                    <p className="text-white font-bold">{func.name}</p>
                                                    {func.first_login && (
                                                        <span className="px-2 py-0.5 rounded text-xs font-bold"
                                                            style={{ backgroundColor: '#2b1f0d', color: '#ffb300' }}>
                                                            Aguarda 1º login
                                                        </span>
                                                    )}
                                                </div>
                                                <p className="text-slate-400 text-xs capitalize">{func.cargo}</p>
                                            </div>
                                            {possoEditar && (
                                                <div className="flex items-center gap-2">
                                                    <button onClick={() => toggleFuncionario(func.id, func.active, func.cargo)}
                                                        className="px-3 py-1 rounded text-xs font-bold"
                                                        style={{ backgroundColor: func.active ? '#0d2b1a' : '#2b0d0d', color: func.active ? '#00e676' : '#ff5252', border: `1px solid ${func.active ? '#00e676' : '#ff5252'}` }}>
                                                        {func.active ? 'Ativo' : 'Inativo'}
                                                    </button>
                                                    <button onClick={() => editandoFunc === func.id ? setEditandoFunc(null) : abrirEdicaoFunc(func)}
                                                        className="px-3 py-1 rounded text-xs font-bold"
                                                        style={{ backgroundColor: '#0f1923', color: '#00b4b4', border: '1px solid #00b4b4' }}>
                                                        {editandoFunc === func.id ? 'Fechar' : 'Editar'}
                                                    </button>
                                                </div>
                                            )}
                                        </div>

                                        {editandoFunc === func.id && possoEditar && (
                                            <div className="px-4 pb-4 flex flex-col gap-4 border-t" style={{ borderColor: '#0f1923' }}>
                                                {podeCriarFunc && (
                                                    <div className="mt-3">
                                                        <label className="text-xs font-bold tracking-widest uppercase text-slate-400 mb-2 block">Cargo</label>
                                                        <select value={cargoEdit} onChange={e => setCargoEdit(e.target.value)}
                                                            className="w-full px-4 py-2 rounded text-white text-sm outline-none"
                                                            style={{ backgroundColor: '#0f1923', border: '1px solid #2a3f52' }}>
                                                            {cargosDisponiveis.map(c => <option key={c} value={c}>{c}</option>)}
                                                        </select>
                                                    </div>
                                                )}
                                                <div>
                                                    <label className="text-xs font-bold tracking-widest uppercase text-slate-400 mb-2 block">Permissões de Módulos</label>
                                                    <div className="grid grid-cols-2 gap-2">
                                                        {modulos.map(m => (
                                                            <button key={m.key}
                                                                onClick={() => setPermissoesEdit(prev => ({ ...prev, [m.key]: !prev[m.key] }))}
                                                                className="flex items-center gap-2 px-3 py-2 rounded text-xs font-bold text-left outline-none"
                                                                style={{ backgroundColor: permissoesEdit[m.key] ? '#0d2b1a' : '#0f1923', color: permissoesEdit[m.key] ? '#00e676' : '#94a3b8', border: `1px solid ${permissoesEdit[m.key] ? '#00e676' : '#2a3f52'}` }}>
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
                                )
                            })}
                        </div>
                    </div>
                )}
            </div>
        </main>
    )
}