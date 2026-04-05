'use client'

import { useState, useRef, useEffect } from 'react'
import { createClient } from '../lib/supabase'
import { useRouter } from 'next/navigation'
import * as XLSX from 'xlsx'

type Pacote = {
    barcode: string
    status: 'ok' | 'inconsistente'
}

type Resultado = {
    recebidos: string[]
    faltantes: string[]
    inconsistentes: string[]
}

export default function RecebimentoPage() {
    const router = useRouter()
    const supabase = createClient()
    const inputRef = useRef<HTMLInputElement>(null)

    const [clientes, setClientes] = useState<any[]>([])
    const [clienteId, setClienteId] = useState('')
    const [companyId, setCompanyId] = useState('')
    const [operatorId, setOperatorId] = useState('')

    const [manifesto, setManifesto] = useState<string[]>([])
    const [manifestoNome, setManifestoNome] = useState('')
    const [bipados, setBipados] = useState<Pacote[]>([])
    const [barcode, setBarcode] = useState('')
    const [fase, setFase] = useState<'setup' | 'bipando' | 'resultado'>('setup')
    const [resultado, setResultado] = useState<Resultado | null>(null)
    const [feedback, setFeedback] = useState<{ msg: string; tipo: 'ok' | 'erro' | 'alerta' } | null>(null)

    useEffect(() => {
        async function init() {
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) { router.push('/login'); return }
            setOperatorId(user.id)

            const { data: userData } = await supabase
                .from('users').select('company_id').eq('id', user.id).single()
            if (!userData) return
            setCompanyId(userData.company_id)

            const { data: clientesData } = await supabase
                .from('clients').select('*').eq('company_id', userData.company_id).eq('active', true)
            setClientes(clientesData || [])
        }
        init()
    }, [])

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
            const codigos = rows
                .flat()
                .map((v: any) => String(v).trim())
                .filter(v => v && v !== 'undefined')
            setManifesto(codigos)
        }
        reader.readAsBinaryString(file)
    }

    function iniciarRecebimento() {
        if (!clienteId) { alert('Selecione o cliente'); return }
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
            setFeedback({ msg: `⚠️ ${codigo} já foi bipado`, tipo: 'alerta' })
            setTimeout(() => setFeedback(null), 2000)
            return
        }

        const noStatus: 'ok' | 'inconsistente' = manifesto.includes(codigo) ? 'ok' : 'inconsistente'
        setBipados(prev => [...prev, { barcode: codigo, status: noStatus }])

        // Salvar no banco
        const { data: pkg } = await supabase.from('packages').insert({
            company_id: companyId,
            client_id: clienteId,
            barcode: codigo,
            status: 'in_warehouse'
        }).select().single()

        if (pkg) {
            await supabase.from('package_events').insert({
                package_id: pkg.id,
                company_id: companyId,
                event_type: 'received',
                operator_id: operatorId,
                operator_name: 'Fernando Souza',
            })
        }

        setFeedback({
            msg: noStatus === 'ok' ? `✅ ${codigo}` : `⚠️ ${codigo} — não estava no manifesto`,
            tipo: noStatus === 'ok' ? 'ok' : 'alerta'
        })
        setTimeout(() => setFeedback(null), 1500)
        inputRef.current?.focus()
    }

    function finalizarRecebimento() {
        const bipedosCodigos = bipados.map(b => b.barcode)
        const recebidos = bipedosCodigos.filter(c => manifesto.includes(c))
        const faltantes = manifesto.filter(c => !bipedosCodigos.includes(c))
        const inconsistentes = bipedosCodigos.filter(c => !manifesto.includes(c))
        setResultado({ recebidos, faltantes, inconsistentes })
        setFase('resultado')
    }

    function exportarRelatorio() {
        if (!resultado) return
        const wb = XLSX.utils.book_new()

        const recebidos = resultado.recebidos.map(c => ({ Codigo: c, Status: 'Recebido' }))
        const faltantes = resultado.faltantes.map(c => ({ Codigo: c, Status: 'Faltante' }))
        const inconsistentes = resultado.inconsistentes.map(c => ({ Codigo: c, Status: 'Inconsistente' }))
        const tudo = [...recebidos, ...faltantes, ...inconsistentes]

        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(tudo), 'Relatório')
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(faltantes), 'Faltantes')
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(inconsistentes), 'Inconsistentes')

        XLSX.writeFile(wb, `recebimento_${new Date().toISOString().slice(0, 10)}.xlsx`)
    }

    const progresso = manifesto.length > 0
        ? Math.min(100, Math.round((bipados.filter(b => b.status === 'ok').length / manifesto.length) * 100))
        : 0

    // ─── TELA SETUP ───
    if (fase === 'setup') return (
        <main className="min-h-screen p-6" style={{ backgroundColor: '#0f1923' }}>
            <div className="max-w-lg mx-auto">
                <button onClick={() => router.push('/dashboard')}
                    className="text-slate-400 text-sm mb-6 hover:text-white">← Voltar</button>
                <h1 className="text-white font-black tracking-widest uppercase text-xl mb-8">
                    📦 Recebimento
                </h1>

                <div className="rounded-lg p-6 flex flex-col gap-6" style={{ backgroundColor: '#1a2736' }}>

                    <div className="flex flex-col gap-2">
                        <label className="text-xs font-bold tracking-widest uppercase text-slate-400">
                            Cliente
                        </label>
                        <select value={clienteId} onChange={e => setClienteId(e.target.value)}
                            className="px-4 py-3 rounded text-white text-sm outline-none"
                            style={{ backgroundColor: '#0f1923', border: '1px solid #2a3f52' }}>
                            <option value="">Selecione o cliente</option>
                            {clientes.map(c => (
                                <option key={c.id} value={c.id}>{c.name}</option>
                            ))}
                        </select>
                    </div>

                    <div className="flex flex-col gap-2">
                        <label className="text-xs font-bold tracking-widest uppercase text-slate-400">
                            Manifesto (Excel ou CSV)
                        </label>
                        <label className="flex items-center justify-center gap-3 px-4 py-3 rounded cursor-pointer text-sm font-bold tracking-widest uppercase"
                            style={{ backgroundColor: '#0f1923', border: '2px dashed #2a3f52', color: '#00b4b4' }}>
                            <span>📁 Escolher arquivo</span>
                            <input type="file" accept=".xlsx,.xls,.csv"
                                onChange={handleUploadManifesto}
                                className="hidden" />
                        </label>
                    </div>

                    <button onClick={iniciarRecebimento}
                        className="py-3 rounded font-black tracking-widest uppercase text-white text-sm"
                        style={{ backgroundColor: '#00b4b4' }}>
                        Iniciar Recebimento
                    </button>
                </div>
            </div>
        </main>
    )

    // ─── TELA BIPANDO ───
    if (fase === 'bipando') return (
        <main className="min-h-screen p-6" style={{ backgroundColor: '#0f1923' }}>
            <div className="max-w-2xl mx-auto">
                <h1 className="text-white font-black tracking-widest uppercase text-xl mb-2">
                    📦 Bipando Pacotes
                </h1>
                <p className="text-slate-400 text-sm mb-6">
                    {clientes.find(c => c.id === clienteId)?.name} — {manifesto.length} esperados
                </p>

                {/* Barra de progresso */}
                <div className="rounded-lg p-4 mb-4" style={{ backgroundColor: '#1a2736' }}>
                    <div className="flex justify-between text-xs text-slate-400 mb-2">
                        <span>{bipados.filter(b => b.status === 'ok').length} de {manifesto.length} conferidos</span>
                        <span>{progresso}%</span>
                    </div>
                    <div className="w-full rounded-full h-3" style={{ backgroundColor: '#0f1923' }}>
                        <div className="h-3 rounded-full transition-all duration-300"
                            style={{ width: `${progresso}%`, backgroundColor: '#00b4b4' }} />
                    </div>
                </div>

                {/* Campo de bipe */}
                <div className="rounded-lg p-4 mb-4" style={{ backgroundColor: '#1a2736' }}>
                    <input ref={inputRef} type="text" value={barcode}
                        onChange={e => setBarcode(e.target.value)}
                        onKeyDown={handleBipe}
                        placeholder="Bipe ou digite o código e pressione Enter"
                        className="w-full px-4 py-4 rounded text-white text-lg outline-none"
                        style={{ backgroundColor: '#0f1923', border: '2px solid #00b4b4' }}
                        autoFocus />
                </div>

                {/* Feedback */}
                {feedback && (
                    <div className="rounded p-3 mb-4 text-sm font-bold tracking-wide"
                        style={{
                            backgroundColor: feedback.tipo === 'ok' ? '#0d2b1a' : feedback.tipo === 'alerta' ? '#2b1f0d' : '#2b0d0d',
                            color: feedback.tipo === 'ok' ? '#00e676' : feedback.tipo === 'alerta' ? '#ffb300' : '#ff5252',
                            border: `1px solid ${feedback.tipo === 'ok' ? '#00e676' : feedback.tipo === 'alerta' ? '#ffb300' : '#ff5252'}`
                        }}>
                        {feedback.msg}
                    </div>
                )}

                {/* Últimos bipados */}
                <div className="rounded-lg p-4 mb-4" style={{ backgroundColor: '#1a2736' }}>
                    <p className="text-xs font-bold tracking-widest uppercase text-slate-400 mb-3">
                        Últimos bipados
                    </p>
                    <div className="flex flex-col gap-2 max-h-48 overflow-y-auto">
                        {[...bipados].reverse().slice(0, 10).map((b, i) => (
                            <div key={i} className="flex items-center justify-between text-sm">
                                <span className="text-white font-mono">{b.barcode}</span>
                                <span className="text-xs font-bold"
                                    style={{ color: b.status === 'ok' ? '#00e676' : '#ffb300' }}>
                                    {b.status === 'ok' ? '✅ OK' : '⚠️ Inconsistente'}
                                </span>
                            </div>
                        ))}
                        {bipados.length === 0 && (
                            <p className="text-slate-500 text-sm">Nenhum pacote bipado ainda</p>
                        )}
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

    // ─── TELA RESULTADO ───
    return (
        <main className="min-h-screen p-6" style={{ backgroundColor: '#0f1923' }}>
            <div className="max-w-2xl mx-auto">
                <h1 className="text-white font-black tracking-widest uppercase text-xl mb-6">
                    📋 Resultado do Recebimento
                </h1>

                <div className="grid grid-cols-3 gap-4 mb-6">
                    <div className="rounded-lg p-4 text-center" style={{ backgroundColor: '#0d2b1a', border: '1px solid #00e676' }}>
                        <p className="text-3xl font-black" style={{ color: '#00e676' }}>
                            {resultado?.recebidos.length}
                        </p>
                        <p className="text-xs font-bold tracking-widest uppercase mt-1" style={{ color: '#00e676' }}>
                            Recebidos
                        </p>
                    </div>
                    <div className="rounded-lg p-4 text-center" style={{ backgroundColor: '#2b0d0d', border: '1px solid #ff5252' }}>
                        <p className="text-3xl font-black" style={{ color: '#ff5252' }}>
                            {resultado?.faltantes.length}
                        </p>
                        <p className="text-xs font-bold tracking-widest uppercase mt-1" style={{ color: '#ff5252' }}>
                            Faltantes
                        </p>
                    </div>
                    <div className="rounded-lg p-4 text-center" style={{ backgroundColor: '#2b1f0d', border: '1px solid #ffb300' }}>
                        <p className="text-3xl font-black" style={{ color: '#ffb300' }}>
                            {resultado?.inconsistentes.length}
                        </p>
                        <p className="text-xs font-bold tracking-widest uppercase mt-1" style={{ color: '#ffb300' }}>
                            Inconsistentes
                        </p>
                    </div>
                </div>

                <div className="flex gap-3">
                    <button onClick={exportarRelatorio}
                        className="flex-1 py-3 rounded font-black tracking-widest uppercase text-white text-sm"
                        style={{ backgroundColor: '#00b4b4' }}>
                        ⬇️ Baixar Relatório Excel
                    </button>
                    <button onClick={() => router.push('/dashboard')}
                        className="flex-1 py-3 rounded font-black tracking-widest uppercase text-white text-sm"
                        style={{ backgroundColor: '#1a2736', border: '1px solid #2a3f52' }}>
                        Voltar ao Dashboard
                    </button>
                </div>
            </div>
        </main>
    )
}