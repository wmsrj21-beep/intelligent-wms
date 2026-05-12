'use client'

import { useState, useRef, useEffect } from 'react'
import { createClient } from '../lib/supabase'
import { useRouter } from 'next/navigation'
import * as XLSX from 'xlsx'
import { somSucesso, somErro, somAlerta, somTransferido } from '../lib/sounds'

type PacoteRec = {
    barcode: string
    status: 'ok' | 'inconsistente'
}

type PacoteTrans = {
    barcode: string
    status: 'ok' | 'erro'
    msg?: string
}

type ResultadoRec = {
    recebidos: string[]
    faltantes: string[]
    inconsistentes: string[]
}

type ResultadoTrans = {
    transferidos: string[]
    erros: string[]
}

type Base = {
    id: string
    name: string
    code: string | null
}

const STATUS_BLOQUEADOS: Record<string, string> = {
    dispatched: 'Pacote em rota com motorista. Processe o retorno antes.',
    extravio: 'Pacote em extravio. Use o modulo Localizar.',
    lost: 'Pacote marcado como Lost. Nao pode ser transferido.',
}

export default function RecebimentoPage() {
    const router = useRouter()
    const supabase = createClient()
    const inputRef = useRef<HTMLInputElement>(null)
    const inputTransRef = useRef<HTMLInputElement>(null)

    // ─── Estado global ───
    const [bases, setBases] = useState<Base[]>([])
    const [companyId, setCompanyId] = useState('')
    const [operatorId, setOperatorId] = useState('')
    const [operatorName, setOperatorName] = useState('')
    const [isSuperAdmin, setIsSuperAdmin] = useState(false)
    const [aba, setAba] = useState<'recebimento' | 'transferencia'>('recebimento')

    // ─── Recebimento ───
    const [baseRec, setBaseRec] = useState('')
    const [baseNomeRec, setBaseNomeRec] = useState('')
    const [clientesRec, setClientesRec] = useState<any[]>([])
    const [clienteIdRec, setClienteIdRec] = useState('')
    const [manifesto, setManifesto] = useState<string[]>([])
    const [manifestoNome, setManifestoNome] = useState('')
    const [barcodeRec, setBarcodeRec] = useState('')
    const [bipadosRec, setBipadosRec] = useState<PacoteRec[]>([])
    const [faseRec, setFaseRec] = useState<'setup' | 'bipando' | 'resultado'>('setup')
    const [resultadoRec, setResultadoRec] = useState<ResultadoRec | null>(null)
    const [feedbackRec, setFeedbackRec] = useState<{ msg: string; tipo: 'ok' | 'erro' | 'alerta' } | null>(null)

    // ─── Transferência ───
    const [baseTrans, setBaseTrans] = useState('')
    const [baseNomeTrans, setBaseNomeTrans] = useState('')
    const [clientesTrans, setClientesTrans] = useState<any[]>([])
    const [clienteIdTrans, setClienteIdTrans] = useState('')
    const [barcodeTrans, setBarcodeTrans] = useState('')
    const [bipadosTrans, setBipadosTrans] = useState<PacoteTrans[]>([])
    const [faseTrans, setFaseTrans] = useState<'setup' | 'bipando' | 'resultado'>('setup')
    const [resultadoTrans, setResultadoTrans] = useState<ResultadoTrans | null>(null)
    const [feedbackTrans, setFeedbackTrans] = useState<{ msg: string; tipo: 'ok' | 'erro' | 'alerta' } | null>(null)

    useEffect(() => {
        async function init() {
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) { router.push('/login'); return }
            setOperatorId(user.id)

            const { data: userData } = await supabase
                .from('users').select('company_id, name, cargo').eq('id', user.id).single()
            if (!userData) return

            setCompanyId(userData.company_id)
            setOperatorName(userData.name)

            const isSA = userData.cargo === 'super_admin' || userData.cargo === 'admin'
            setIsSuperAdmin(isSA)

            if (isSA) {
                const { data: basesData } = await supabase
                    .from('companies').select('id, name, code').eq('active', true).order('name')
                setBases(basesData || [])
            } else {
                const { data: basesData } = await supabase
                    .from('user_bases').select('company_id, companies(id, name, code)').eq('user_id', user.id)
                const basesDoUser = basesData?.map((ub: any) => ub.companies).filter(Boolean) || []
                if (basesDoUser.length === 0) {
                    const { data: companyData } = await supabase
                        .from('companies').select('id, name, code').eq('id', userData.company_id).single()
                    if (companyData) {
                        setBases([companyData])
                        setBaseRec(companyData.id)
                        setBaseNomeRec(companyData.code ? `${companyData.code} — ${companyData.name}` : companyData.name)
                        await carregarClientesRec(companyData.id)
                    }
                } else {
                    setBases(basesDoUser)
                    if (basesDoUser.length === 1) {
                        setBaseRec(basesDoUser[0].id)
                        setBaseNomeRec(basesDoUser[0].code ? `${basesDoUser[0].code} — ${basesDoUser[0].name}` : basesDoUser[0].name)
                        await carregarClientesRec(basesDoUser[0].id)
                    }
                }
            }
        }
        init()
    }, [])

    // ─── RECEBIMENTO ───
    async function carregarClientesRec(baseId: string) {
        const { data } = await supabase.from('clients')
            .select('id, name, code, active, barcode_prefix, barcode_min_length, barcode_max_length')
            .eq('company_id', baseId).eq('active', true).order('name')
        setClientesRec(data || [])
        setClienteIdRec('')
    }

    async function handleBaseRecChange(baseId: string) {
        setBaseRec(baseId)
        const base = bases.find(b => b.id === baseId)
        setBaseNomeRec(base ? (base.code ? `${base.code} — ${base.name}` : base.name) : '')
        await carregarClientesRec(baseId)
    }

    function handleUploadManifesto(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0]
        if (!file) return
        setManifestoNome(file.name)
        const reader = new FileReader()
        reader.onload = (evt) => {
            const data = evt.target?.result
            const workbook = XLSX.read(data, { type: 'binary' })
            const sheet = workbook.Sheets[workbook.SheetNames[0]]
            const rows: any[] = XLSX.utils.sheet_to_json(sheet, { header: 1 })
            const codigos = rows.flat().map((v: any) => String(v).trim()).filter(v => v && v !== 'undefined')
            setManifesto(codigos)
        }
        reader.readAsBinaryString(file)
    }

    function iniciarRecebimento() {
        if (!baseRec) { alert('Selecione a base'); return }
        if (!clienteIdRec) { alert('Selecione o cliente'); return }
        setFaseRec('bipando')
        setTimeout(() => inputRef.current?.focus(), 100)
    }

    async function handleBipeRec(e: React.KeyboardEvent<HTMLInputElement>) {
        if (e.key !== 'Enter') return
        const codigo = barcodeRec.trim()
        if (!codigo) return
        setBarcodeRec('')

        if (bipadosRec.find(b => b.barcode === codigo)) {
            somAlerta()
            setFeedbackRec({ msg: `${codigo} ja foi bipado`, tipo: 'alerta' })
            setTimeout(() => setFeedbackRec(null), 2000)
            return
        }

        // Validação de código por cliente
        const clienteAtual = clientesRec.find(c => c.id === clienteIdRec)
        if (clienteAtual && (clienteAtual.barcode_prefix || clienteAtual.barcode_min_length)) {
            const prefixo = clienteAtual.barcode_prefix
            const min = clienteAtual.barcode_min_length
            const max = clienteAtual.barcode_max_length
            if (prefixo && !codigo.startsWith(prefixo)) {
                somErro()
                setFeedbackRec({ msg: `Codigo invalido. Deve iniciar com ${prefixo}`, tipo: 'erro' })
                setTimeout(() => setFeedbackRec(null), 4000)
                inputRef.current?.focus()
                return
            }
            if (min && codigo.length < min) {
                somErro()
                setFeedbackRec({ msg: `Codigo muito curto. Minimo ${min} caracteres`, tipo: 'erro' })
                setTimeout(() => setFeedbackRec(null), 4000)
                inputRef.current?.focus()
                return
            }
            if (max && codigo.length > max) {
                somErro()
                setFeedbackRec({ msg: `Codigo muito longo. Maximo ${max} caracteres`, tipo: 'erro' })
                setTimeout(() => setFeedbackRec(null), 4000)
                inputRef.current?.focus()
                return
            }
        }

        const { data: pkgsEncontrados } = await supabase.from('packages')
            .select('id, status, company_id').eq('barcode', codigo)
            .order('created_at', { ascending: false }).limit(1)
        const pkg = pkgsEncontrados?.[0] || null

        if (pkg && STATUS_BLOQUEADOS[pkg.status]) {
            somErro()
            setFeedbackRec({ msg: `${codigo} — ${STATUS_BLOQUEADOS[pkg.status]}`, tipo: 'erro' })
            setTimeout(() => setFeedbackRec(null), 4000)
            inputRef.current?.focus()
            return
        }

        // Pacote de outra base — bloqueia no recebimento, deve usar transferência
        if (pkg && pkg.company_id !== baseRec) {
            somErro()
            setFeedbackRec({ msg: `${codigo} pertence a outra base. Use a aba Transferencia.`, tipo: 'erro' })
            setTimeout(() => setFeedbackRec(null), 4000)
            inputRef.current?.focus()
            return
        }

        if (pkg) {
            const noStatus: 'ok' | 'inconsistente' = manifesto.includes(codigo) ? 'ok' : 'inconsistente'
            setBipadosRec(prev => [...prev, { barcode: codigo, status: noStatus }])
            await supabase.from('packages').update({ status: 'in_warehouse' }).eq('id', pkg.id)
            await supabase.from('package_events').insert({
                package_id: pkg.id, company_id: baseRec,
                event_type: 'received', operator_id: operatorId,
                operator_name: operatorName, location: baseNomeRec,
            })
            if (noStatus === 'ok') somSucesso()
            else somAlerta()
            setFeedbackRec({ msg: noStatus === 'ok' ? `${codigo}` : `${codigo} — nao estava no manifesto`, tipo: noStatus === 'ok' ? 'ok' : 'alerta' })
            setTimeout(() => setFeedbackRec(null), 1500)
            inputRef.current?.focus()
            return
        }

        // Novo pacote
        const noStatus: 'ok' | 'inconsistente' = manifesto.includes(codigo) ? 'ok' : 'inconsistente'
        setBipadosRec(prev => [...prev, { barcode: codigo, status: noStatus }])
        const { data: novoPkg } = await supabase.from('packages').insert({
            company_id: baseRec, client_id: clienteIdRec, barcode: codigo, status: 'in_warehouse'
        }).select().single()
        if (novoPkg) {
            await supabase.from('package_events').insert({
                package_id: novoPkg.id, company_id: baseRec,
                event_type: 'received', operator_id: operatorId,
                operator_name: operatorName, location: baseNomeRec,
            })
        }
        if (noStatus === 'ok') somSucesso()
        else somAlerta()
        setFeedbackRec({ msg: noStatus === 'ok' ? `${codigo}` : `${codigo} — nao estava no manifesto`, tipo: noStatus === 'ok' ? 'ok' : 'alerta' })
        setTimeout(() => setFeedbackRec(null), 1500)
        inputRef.current?.focus()
    }

    function finalizarRecebimento() {
        const bipedosCodigos = bipadosRec.map(b => b.barcode)
        setResultadoRec({
            recebidos: bipedosCodigos.filter(c => manifesto.includes(c) && bipadosRec.find(b => b.barcode === c)?.status === 'ok'),
            faltantes: manifesto.filter(c => !bipedosCodigos.includes(c)),
            inconsistentes: bipedosCodigos.filter(c => bipadosRec.find(b => b.barcode === c)?.status === 'inconsistente'),
        })
        setFaseRec('resultado')
    }

    function exportarRelatorioRec() {
        if (!resultadoRec) return
        const wb = XLSX.utils.book_new()
        const rows = [
            ...resultadoRec.recebidos.map(c => ({ Codigo: c, Status: 'Recebido', Base: baseNomeRec })),
            ...resultadoRec.faltantes.map(c => ({ Codigo: c, Status: 'Faltante', Base: baseNomeRec })),
            ...resultadoRec.inconsistentes.map(c => ({ Codigo: c, Status: 'Inconsistente', Base: baseNomeRec })),
        ]
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Relatorio')
        XLSX.writeFile(wb, `recebimento_${new Date().toISOString().slice(0, 10)}.xlsx`)
    }

    const progressoRec = manifesto.length > 0
        ? Math.min(100, Math.round((bipadosRec.filter(b => b.status === 'ok').length / manifesto.length) * 100))
        : 0

    // ─── TRANSFERÊNCIA ───
    async function carregarClientesTrans(baseId: string) {
        const { data } = await supabase.from('clients')
            .select('id, name, code, active')
            .eq('company_id', baseId).eq('active', true).order('name')
        setClientesTrans(data || [])
        setClienteIdTrans('')
    }

    async function handleBaseTransChange(baseId: string) {
        setBaseTrans(baseId)
        const base = bases.find(b => b.id === baseId)
        setBaseNomeTrans(base ? (base.code ? `${base.code} — ${base.name}` : base.name) : '')
        await carregarClientesTrans(baseId)
    }

    function iniciarTransferencia() {
        if (!baseTrans) { alert('Selecione a base destino'); return }
        if (!clienteIdTrans) { alert('Selecione o cliente'); return }
        setFaseTrans('bipando')
        setTimeout(() => inputTransRef.current?.focus(), 100)
    }

    async function handleBipeTrans(e: React.KeyboardEvent<HTMLInputElement>) {
        if (e.key !== 'Enter') return
        const codigo = barcodeTrans.trim()
        if (!codigo) return
        setBarcodeTrans('')

        if (bipadosTrans.find(b => b.barcode === codigo)) {
            somAlerta()
            setFeedbackTrans({ msg: `${codigo} ja foi bipado`, tipo: 'alerta' })
            setTimeout(() => setFeedbackTrans(null), 2000)
            return
        }

        const { data: pkgsEncontrados } = await supabase.from('packages')
            .select('id, status, company_id').eq('barcode', codigo)
            .order('created_at', { ascending: false }).limit(1)
        const pkg = pkgsEncontrados?.[0] || null

        if (!pkg) {
            somErro()
            setBipadosTrans(prev => [...prev, { barcode: codigo, status: 'erro', msg: 'Pacote nao encontrado no sistema' }])
            setFeedbackTrans({ msg: `${codigo} — nao encontrado`, tipo: 'erro' })
            setTimeout(() => setFeedbackTrans(null), 3000)
            inputTransRef.current?.focus()
            return
        }

        if (STATUS_BLOQUEADOS[pkg.status]) {
            somErro()
            setBipadosTrans(prev => [...prev, { barcode: codigo, status: 'erro', msg: STATUS_BLOQUEADOS[pkg.status] }])
            setFeedbackTrans({ msg: `${codigo} — ${STATUS_BLOQUEADOS[pkg.status]}`, tipo: 'erro' })
            setTimeout(() => setFeedbackTrans(null), 4000)
            inputTransRef.current?.focus()
            return
        }

        if (pkg.company_id === baseTrans) {
            somErro()
            setBipadosTrans(prev => [...prev, { barcode: codigo, status: 'erro', msg: 'Pacote ja esta nesta base' }])
            setFeedbackTrans({ msg: `${codigo} — ja esta na base destino`, tipo: 'erro' })
            setTimeout(() => setFeedbackTrans(null), 3000)
            inputTransRef.current?.focus()
            return
        }

        // Transferência — 1 único evento
        const baseOrigem = pkg.company_id
        await supabase.from('packages').update({
            company_id: baseTrans, client_id: clienteIdTrans, status: 'in_warehouse'
        }).eq('id', pkg.id)
        await supabase.from('package_events').insert({
            package_id: pkg.id, company_id: baseTrans,
            event_type: 'transferred', operator_id: operatorId,
            operator_name: operatorName, location: baseNomeTrans,
            outcome_notes: `Transferido de ${baseOrigem} para ${baseNomeTrans}`
        })

        somTransferido()
        setBipadosTrans(prev => [...prev, { barcode: codigo, status: 'ok' }])
        setFeedbackTrans({ msg: `${codigo} — Transferido para ${baseNomeTrans}`, tipo: 'ok' })
        setTimeout(() => setFeedbackTrans(null), 2000)
        inputTransRef.current?.focus()
    }

    function finalizarTransferencia() {
        setResultadoTrans({
            transferidos: bipadosTrans.filter(b => b.status === 'ok').map(b => b.barcode),
            erros: bipadosTrans.filter(b => b.status === 'erro').map(b => b.barcode),
        })
        setFaseTrans('resultado')
    }

    function exportarRelatorioTrans() {
        if (!resultadoTrans) return
        const wb = XLSX.utils.book_new()
        const rows = [
            ...resultadoTrans.transferidos.map(c => ({ Codigo: c, Status: 'Transferido', BaseDestino: baseNomeTrans })),
            ...resultadoTrans.erros.map(c => ({ Codigo: c, Status: 'Erro', BaseDestino: baseNomeTrans })),
        ]
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Transferencia')
        XLSX.writeFile(wb, `transferencia_${new Date().toISOString().slice(0, 10)}.xlsx`)
    }

    // ─── RENDER RECEBIMENTO SETUP ───
    if (faseRec === 'setup' && faseTrans === 'setup') return (
        <main className="min-h-screen p-6" style={{ backgroundColor: '#0f1923' }}>
            <div className="max-w-lg mx-auto">
                <button onClick={() => router.push('/dashboard')}
                    className="text-slate-400 text-sm mb-6 hover:text-white">← Voltar</button>
                <h1 className="text-white font-black tracking-widest uppercase text-xl mb-6">
                    📦 Recebimento
                </h1>

                {/* Abas */}
                <div className="flex gap-2 mb-6">
                    <button onClick={() => setAba('recebimento')}
                        className="flex-1 py-2 rounded font-black tracking-widest uppercase text-sm outline-none"
                        style={{ backgroundColor: aba === 'recebimento' ? '#00b4b4' : '#1a2736', color: 'white' }}>
                        Recebimento
                    </button>
                    <button onClick={() => setAba('transferencia')}
                        className="flex-1 py-2 rounded font-black tracking-widest uppercase text-sm outline-none"
                        style={{ backgroundColor: aba === 'transferencia' ? '#00b4b4' : '#1a2736', color: 'white' }}>
                        Transferência
                    </button>
                </div>

                {/* ─── ABA RECEBIMENTO ─── */}
                {aba === 'recebimento' && (
                    <div className="rounded-lg p-6 flex flex-col gap-6" style={{ backgroundColor: '#1a2736' }}>
                        {(isSuperAdmin || bases.length > 1) && (
                            <div className="flex flex-col gap-2">
                                <label className="text-xs font-bold tracking-widest uppercase text-slate-400">Base</label>
                                <select value={baseRec} onChange={e => handleBaseRecChange(e.target.value)}
                                    className="px-4 py-3 rounded text-white text-sm outline-none"
                                    style={{ backgroundColor: '#0f1923', border: '1px solid #2a3f52' }}>
                                    <option value="">Selecione a base</option>
                                    {bases.map(b => (
                                        <option key={b.id} value={b.id}>{b.code ? `${b.code} — ` : ''}{b.name}</option>
                                    ))}
                                </select>
                            </div>
                        )}
                        <div className="flex flex-col gap-2">
                            <label className="text-xs font-bold tracking-widest uppercase text-slate-400">Cliente</label>
                            <select value={clienteIdRec} onChange={e => setClienteIdRec(e.target.value)}
                                className="px-4 py-3 rounded text-white text-sm outline-none"
                                style={{ backgroundColor: '#0f1923', border: '1px solid #2a3f52' }}
                                disabled={!baseRec}>
                                <option value="">Selecione o cliente</option>
                                {clientesRec.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                            </select>
                            {clienteIdRec && (() => {
                                const c = clientesRec.find(cl => cl.id === clienteIdRec)
                                return c?.barcode_prefix ? (
                                    <p className="text-xs" style={{ color: '#00b4b4' }}>
                                        Validacao ativa: prefixo {c.barcode_prefix}, {c.barcode_min_length}–{c.barcode_max_length} caracteres
                                    </p>
                                ) : null
                            })()}
                        </div>
                        <div className="flex flex-col gap-2">
                            <label className="text-xs font-bold tracking-widest uppercase text-slate-400">
                                Manifesto (Excel ou CSV)
                            </label>
                            <label className="flex items-center justify-center gap-3 px-4 py-3 rounded cursor-pointer text-sm font-bold tracking-widest uppercase"
                                style={{ backgroundColor: '#0f1923', border: '2px dashed #2a3f52', color: '#00b4b4' }}>
                                <span>📁 {manifestoNome || 'Escolher arquivo'}</span>
                                <input type="file" accept=".xlsx,.xls,.csv" onChange={handleUploadManifesto} className="hidden" />
                            </label>
                            {manifestoNome && <p className="text-xs" style={{ color: '#00b4b4' }}>✅ {manifesto.length} codigos carregados</p>}
                        </div>
                        <button onClick={iniciarRecebimento}
                            className="py-3 rounded font-black tracking-widest uppercase text-white text-sm"
                            style={{ backgroundColor: '#00b4b4' }}>
                            Iniciar Recebimento
                        </button>
                    </div>
                )}

                {/* ─── ABA TRANSFERÊNCIA ─── */}
                {aba === 'transferencia' && (
                    <div className="rounded-lg p-6 flex flex-col gap-6" style={{ backgroundColor: '#1a2736' }}>
                        <div className="flex flex-col gap-2">
                            <label className="text-xs font-bold tracking-widest uppercase text-slate-400">Base Destino</label>
                            <select value={baseTrans} onChange={e => handleBaseTransChange(e.target.value)}
                                className="px-4 py-3 rounded text-white text-sm outline-none"
                                style={{ backgroundColor: '#0f1923', border: '1px solid #2a3f52' }}>
                                <option value="">Selecione a base destino</option>
                                {bases.map(b => (
                                    <option key={b.id} value={b.id}>{b.code ? `${b.code} — ` : ''}{b.name}</option>
                                ))}
                            </select>
                        </div>
                        <div className="flex flex-col gap-2">
                            <label className="text-xs font-bold tracking-widest uppercase text-slate-400">Cliente</label>
                            <select value={clienteIdTrans} onChange={e => setClienteIdTrans(e.target.value)}
                                className="px-4 py-3 rounded text-white text-sm outline-none"
                                style={{ backgroundColor: '#0f1923', border: '1px solid #2a3f52' }}
                                disabled={!baseTrans}>
                                <option value="">Selecione o cliente</option>
                                {clientesTrans.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                            </select>
                        </div>
                        <div className="rounded p-3 text-xs" style={{ backgroundColor: '#0f1923', color: '#94a3b8' }}>
                            🔄 Transfere pacotes de qualquer base para a base destino. Gera apenas 1 evento no histórico.
                        </div>
                        <button onClick={iniciarTransferencia}
                            className="py-3 rounded font-black tracking-widest uppercase text-white text-sm"
                            style={{ backgroundColor: '#00b4b4' }}>
                            Iniciar Transferência
                        </button>
                    </div>
                )}
            </div>
        </main>
    )

    // ─── RECEBIMENTO BIPANDO ───
    if (faseRec === 'bipando') return (
        <main className="min-h-screen p-6" style={{ backgroundColor: '#0f1923' }}>
            <div className="max-w-2xl mx-auto">
                <button onClick={() => setFaseRec('setup')}
                    className="text-slate-400 text-sm mb-6 hover:text-white">← Voltar</button>
                <h1 className="text-white font-black tracking-widest uppercase text-xl mb-1">📦 Bipando Pacotes</h1>
                <p className="text-xs mb-1" style={{ color: '#00b4b4' }}>📍 {baseNomeRec}</p>
                <p className="text-slate-400 text-sm mb-6">
                    {clientesRec.find(c => c.id === clienteIdRec)?.name}
                    {manifesto.length > 0 ? ` — ${manifesto.length} esperados` : ''}
                </p>

                {manifesto.length > 0 && (
                    <div className="rounded-lg p-4 mb-4" style={{ backgroundColor: '#1a2736' }}>
                        <div className="flex justify-between text-xs text-slate-400 mb-2">
                            <span>{bipadosRec.filter(b => b.status === 'ok').length} de {manifesto.length} conferidos</span>
                            <span>{progressoRec}%</span>
                        </div>
                        <div className="w-full rounded-full h-3" style={{ backgroundColor: '#0f1923' }}>
                            <div className="h-3 rounded-full transition-all" style={{ width: `${progressoRec}%`, backgroundColor: '#00b4b4' }} />
                        </div>
                    </div>
                )}

                <div className="rounded-lg p-4 mb-4" style={{ backgroundColor: '#1a2736' }}>
                    <input ref={inputRef} type="text" value={barcodeRec}
                        onChange={e => setBarcodeRec(e.target.value)} onKeyDown={handleBipeRec}
                        placeholder="Bipe ou digite o codigo e pressione Enter"
                        className="w-full px-4 py-4 rounded text-white text-lg outline-none"
                        style={{ backgroundColor: '#0f1923', border: '2px solid #00b4b4' }} autoFocus />
                </div>

                {feedbackRec && (
                    <div className="rounded p-3 mb-4 text-sm font-bold"
                        style={{
                            backgroundColor: feedbackRec.tipo === 'ok' ? '#0d2b1a' : feedbackRec.tipo === 'alerta' ? '#2b1f0d' : '#2b0d0d',
                            color: feedbackRec.tipo === 'ok' ? '#00e676' : feedbackRec.tipo === 'alerta' ? '#ffb300' : '#ff5252',
                            border: `1px solid ${feedbackRec.tipo === 'ok' ? '#00e676' : feedbackRec.tipo === 'alerta' ? '#ffb300' : '#ff5252'}`
                        }}>
                        {feedbackRec.msg}
                    </div>
                )}

                <div className="rounded-lg p-4 mb-4" style={{ backgroundColor: '#1a2736' }}>
                    <p className="text-xs font-bold tracking-widest uppercase text-slate-400 mb-3">
                        Ultimos bipados — {bipadosRec.length} total
                    </p>
                    <div className="flex flex-col gap-2 max-h-48 overflow-y-auto">
                        {[...bipadosRec].reverse().slice(0, 10).map((b, i) => (
                            <div key={i} className="flex items-center justify-between text-sm">
                                <span className="text-white font-mono">{b.barcode}</span>
                                <span className="text-xs font-bold" style={{ color: b.status === 'ok' ? '#00e676' : '#ffb300' }}>
                                    {b.status === 'ok' ? '✅ OK' : '⚠️ Inconsistente'}
                                </span>
                            </div>
                        ))}
                        {bipadosRec.length === 0 && <p className="text-slate-500 text-sm">Nenhum pacote bipado ainda</p>}
                    </div>
                </div>

                <button onClick={finalizarRecebimento}
                    className="w-full py-3 rounded font-black tracking-widest uppercase text-white text-sm"
                    style={{ backgroundColor: '#c0392b' }}>
                    Finalizar Recebimento
                </button>
            </div>
        </main>
    )

    // ─── RECEBIMENTO RESULTADO ───
    if (faseRec === 'resultado') return (
        <main className="min-h-screen p-6" style={{ backgroundColor: '#0f1923' }}>
            <div className="max-w-2xl mx-auto">
                <h1 className="text-white font-black tracking-widest uppercase text-xl mb-1">📋 Resultado do Recebimento</h1>
                <p className="text-xs mb-6" style={{ color: '#00b4b4' }}>📍 {baseNomeRec}</p>
                <div className="grid grid-cols-3 gap-3 mb-6">
                    <div className="rounded-lg p-4 text-center" style={{ backgroundColor: '#0d2b1a', border: '1px solid #00e676' }}>
                        <p className="text-2xl font-black" style={{ color: '#00e676' }}>{resultadoRec?.recebidos.length}</p>
                        <p className="text-xs font-bold tracking-widest uppercase mt-1" style={{ color: '#00e676' }}>Recebidos</p>
                    </div>
                    <div className="rounded-lg p-4 text-center" style={{ backgroundColor: '#2b0d0d', border: '1px solid #ff5252' }}>
                        <p className="text-2xl font-black" style={{ color: '#ff5252' }}>{resultadoRec?.faltantes.length}</p>
                        <p className="text-xs font-bold tracking-widest uppercase mt-1" style={{ color: '#ff5252' }}>Faltantes</p>
                    </div>
                    <div className="rounded-lg p-4 text-center" style={{ backgroundColor: '#2b1f0d', border: '1px solid #ffb300' }}>
                        <p className="text-2xl font-black" style={{ color: '#ffb300' }}>{resultadoRec?.inconsistentes.length}</p>
                        <p className="text-xs font-bold tracking-widest uppercase mt-1" style={{ color: '#ffb300' }}>Inconsistentes</p>
                    </div>
                </div>
                <div className="flex gap-3">
                    <button onClick={exportarRelatorioRec}
                        className="flex-1 py-3 rounded font-black tracking-widest uppercase text-white text-sm"
                        style={{ backgroundColor: '#00b4b4' }}>
                        ⬇️ Baixar Relatorio Excel
                    </button>
                    <button onClick={() => router.push('/dashboard')}
                        className="flex-1 py-3 rounded font-black tracking-widest uppercase text-white text-sm"
                        style={{ backgroundColor: '#1a2736', border: '1px solid #2a3f52' }}>
                        Dashboard
                    </button>
                </div>
            </div>
        </main>
    )

    // ─── TRANSFERÊNCIA BIPANDO ───
    if (faseTrans === 'bipando') return (
        <main className="min-h-screen p-6" style={{ backgroundColor: '#0f1923' }}>
            <div className="max-w-2xl mx-auto">
                <button onClick={() => setFaseTrans('setup')}
                    className="text-slate-400 text-sm mb-6 hover:text-white">← Voltar</button>
                <h1 className="text-white font-black tracking-widest uppercase text-xl mb-1">🔄 Transferindo Pacotes</h1>
                <p className="text-xs mb-1" style={{ color: '#00b4b4' }}>📍 Destino: {baseNomeTrans}</p>
                <p className="text-slate-400 text-sm mb-6">{clientesTrans.find(c => c.id === clienteIdTrans)?.name}</p>

                <div className="rounded-lg p-4 mb-4" style={{ backgroundColor: '#1a2736' }}>
                    <input ref={inputTransRef} type="text" value={barcodeTrans}
                        onChange={e => setBarcodeTrans(e.target.value)} onKeyDown={handleBipeTrans}
                        placeholder="Bipe ou digite o codigo e pressione Enter"
                        className="w-full px-4 py-4 rounded text-white text-lg outline-none"
                        style={{ backgroundColor: '#0f1923', border: '2px solid #00b4b4' }} autoFocus />
                </div>

                {feedbackTrans && (
                    <div className="rounded p-3 mb-4 text-sm font-bold"
                        style={{
                            backgroundColor: feedbackTrans.tipo === 'ok' ? '#0d2b1a' : feedbackTrans.tipo === 'alerta' ? '#2b1f0d' : '#2b0d0d',
                            color: feedbackTrans.tipo === 'ok' ? '#00e676' : feedbackTrans.tipo === 'alerta' ? '#ffb300' : '#ff5252',
                            border: `1px solid ${feedbackTrans.tipo === 'ok' ? '#00e676' : feedbackTrans.tipo === 'alerta' ? '#ffb300' : '#ff5252'}`
                        }}>
                        {feedbackTrans.msg}
                    </div>
                )}

                <div className="rounded-lg p-4 mb-4" style={{ backgroundColor: '#1a2736' }}>
                    <p className="text-xs font-bold tracking-widest uppercase text-slate-400 mb-3">
                        Ultimos bipados — {bipadosTrans.length} total
                    </p>
                    <div className="flex flex-col gap-2 max-h-48 overflow-y-auto">
                        {[...bipadosTrans].reverse().slice(0, 10).map((b, i) => (
                            <div key={i} className="flex items-center justify-between text-sm">
                                <span className="text-white font-mono">{b.barcode}</span>
                                <span className="text-xs font-bold" style={{ color: b.status === 'ok' ? '#00e676' : '#ff5252' }}>
                                    {b.status === 'ok' ? '🔄 Transferido' : `❌ ${b.msg}`}
                                </span>
                            </div>
                        ))}
                        {bipadosTrans.length === 0 && <p className="text-slate-500 text-sm">Nenhum pacote bipado ainda</p>}
                    </div>
                </div>

                <button onClick={finalizarTransferencia}
                    className="w-full py-3 rounded font-black tracking-widest uppercase text-white text-sm"
                    style={{ backgroundColor: '#c0392b' }}>
                    Finalizar Transferência
                </button>
            </div>
        </main>
    )

    // ─── TRANSFERÊNCIA RESULTADO ───
    return (
        <main className="min-h-screen p-6" style={{ backgroundColor: '#0f1923' }}>
            <div className="max-w-2xl mx-auto">
                <h1 className="text-white font-black tracking-widest uppercase text-xl mb-1">🔄 Transferência Finalizada</h1>
                <p className="text-xs mb-6" style={{ color: '#00b4b4' }}>📍 Destino: {baseNomeTrans}</p>
                <div className="grid grid-cols-2 gap-3 mb-6">
                    <div className="rounded-lg p-4 text-center" style={{ backgroundColor: '#0d2b1a', border: '1px solid #00e676' }}>
                        <p className="text-2xl font-black" style={{ color: '#00e676' }}>{resultadoTrans?.transferidos.length}</p>
                        <p className="text-xs font-bold tracking-widest uppercase mt-1" style={{ color: '#00e676' }}>Transferidos</p>
                    </div>
                    <div className="rounded-lg p-4 text-center"
                        style={{ backgroundColor: (resultadoTrans?.erros.length ?? 0) > 0 ? '#2b0d0d' : '#1a2736', border: `1px solid ${(resultadoTrans?.erros.length ?? 0) > 0 ? '#ff5252' : '#2a3f52'}` }}>
                        <p className="text-2xl font-black" style={{ color: (resultadoTrans?.erros.length ?? 0) > 0 ? '#ff5252' : '#94a3b8' }}>{resultadoTrans?.erros.length}</p>
                        <p className="text-xs font-bold tracking-widest uppercase mt-1" style={{ color: (resultadoTrans?.erros.length ?? 0) > 0 ? '#ff5252' : '#94a3b8' }}>Erros</p>
                    </div>
                </div>
                <div className="flex gap-3">
                    <button onClick={exportarRelatorioTrans}
                        className="flex-1 py-3 rounded font-black tracking-widest uppercase text-white text-sm"
                        style={{ backgroundColor: '#00b4b4' }}>
                        ⬇️ Baixar Relatorio Excel
                    </button>
                    <button onClick={() => router.push('/dashboard')}
                        className="flex-1 py-3 rounded font-black tracking-widest uppercase text-white text-sm"
                        style={{ backgroundColor: '#1a2736', border: '1px solid #2a3f52' }}>
                        Dashboard
                    </button>
                </div>
            </div>
        </main>
    )
}