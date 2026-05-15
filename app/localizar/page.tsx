'use client'

import { useState, useRef, useEffect } from 'react'
import { createClient } from '../lib/supabase'
import { useRouter } from 'next/navigation'
import { somSucesso, somErro, somAlerta } from '../lib/sounds'

type PacoteLocalizado = {
    barcode: string
    client_name: string
    status: 'ok' | 'erro'
    msg: string
}

const MSG_STATUS: Record<string, string> = {
    in_warehouse: '📦 Pacote já está no armazém.',
    dispatched: '🚚 Pacote em rota com motorista. Processe o retorno.',
    delivered: '✅ Pacote já foi entregue.',
    unsuccessful: '⚠️ Pacote com insucesso pendente. Use o Retorno de Rua.',
    returned: '↩️ Pacote já foi devolvido ao armazém.',
    incident: '🚨 Pacote com incidente aberto. Resolva no Armazém.',
    lost: '💀 Pacote marcado como Lost. Não pode ser localizado.',
    devolvido_cliente: '📤 Pacote já devolvido ao cliente.',
}

export default function LocalizarPage() {
    const router = useRouter()
    const supabase = createClient()
    const inputRef = useRef<HTMLInputElement>(null)

    const [companyId, setCompanyId] = useState('')
    const [operatorId, setOperatorId] = useState('')
    const [operatorName, setOperatorName] = useState('')
    const [baseName, setBaseName] = useState('')

    const [barcode, setBarcode] = useState('')
    const [localizados, setLocalizados] = useState<PacoteLocalizado[]>([])
    const [feedback, setFeedback] = useState<{ msg: string; tipo: 'ok' | 'erro' | 'alerta' } | null>(null)
    const [buscando, setBuscando] = useState(false)
    const [podeRemoverExpedicao, setPodeRemoverExpedicao] = useState(false)

    useEffect(() => {
        async function init() {
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) { router.push('/login'); return }
            setOperatorId(user.id)

            const { data: userData } = await supabase
                .from('users').select('company_id, name, permissao_remover_expedicao').eq('id', user.id).single()
            if (!userData) return
            setOperatorName(userData.name)
            setPodeRemoverExpedicao(userData.permissao_remover_expedicao || false)

            const savedBase = typeof window !== 'undefined' ? localStorage.getItem('wms_base_selecionada') : null
            const cid = savedBase || userData.company_id
            setCompanyId(cid)

            const { data: companyData } = await supabase
                .from('companies').select('name, code').eq('id', cid).single()
            if (companyData) {
                setBaseName(companyData.code ? `${companyData.code} — ${companyData.name}` : companyData.name)
            }

            setTimeout(() => inputRef.current?.focus(), 100)
        }
        init()
    }, [])

    async function handleBipe(e: React.KeyboardEvent<HTMLInputElement>) {
        if (e.key !== 'Enter') return
        const codigo = barcode.trim()
        if (!codigo) return
        setBarcode('')

        const jaBipado = localizados.find(p => p.barcode === codigo && p.status === 'ok')
        if (jaBipado) {
            somAlerta()
            setFeedback({ msg: `⚠️ ${codigo} já foi localizado nesta sessão`, tipo: 'alerta' })
            setTimeout(() => setFeedback(null), 2000)
            inputRef.current?.focus()
            return
        }

        setBuscando(true)

        const { data: pkgs } = await supabase
            .from('packages')
            .select('id, status, company_id, clients(name)')
            .eq('barcode', codigo)
            .order('created_at', { ascending: false })
            .limit(1)

        setBuscando(false)
        const pkg = pkgs?.[0]

        if (!pkg) {
            somErro()
            setLocalizados(prev => [...prev, {
                barcode: codigo, client_name: '-',
                status: 'erro', msg: 'Pacote não encontrado no sistema'
            }])
            setFeedback({ msg: `❌ ${codigo} — não encontrado`, tipo: 'erro' })
            setTimeout(() => setFeedback(null), 3000)
            inputRef.current?.focus()
            return
        }

        // Pacote dispatched — só quem tem permissão pode remover da expedição
        if (pkg.status === 'dispatched') {
            if (!podeRemoverExpedicao) {
                somErro()
                const msg = MSG_STATUS['dispatched']
                setLocalizados(prev => [...prev, {
                    barcode: codigo,
                    client_name: (pkg.clients as any)?.name || '-',
                    status: 'erro', msg
                }])
                setFeedback({ msg: `❌ ${codigo} — ${msg}`, tipo: 'erro' })
                setTimeout(() => setFeedback(null), 4000)
                inputRef.current?.focus()
                return
            }

            // Tem permissão — remove da expedição
            await supabase.from('packages').update({ status: 'in_warehouse' }).eq('id', pkg.id)
            await supabase.from('package_events').insert({
                package_id: pkg.id,
                company_id: companyId,
                event_type: 'removed',
                operator_id: operatorId,
                operator_name: operatorName,
                location: baseName,
                outcome_notes: 'Removido da expedição via módulo Localizar'
            })
            const clientName = (pkg.clients as any)?.name || '-'
            somSucesso()
            setLocalizados(prev => [...prev, {
                barcode: codigo, client_name: clientName,
                status: 'ok', msg: 'Removido da expedição — voltou ao armazém'
            }])
            setFeedback({ msg: `🗑️ ${codigo} — ${clientName} — Removido da expedição!`, tipo: 'ok' })
            setTimeout(() => setFeedback(null), 3000)
            inputRef.current?.focus()
            return
        }

        // Bloqueia qualquer outro status que não seja extravio
        if (pkg.status !== 'extravio') {
            somErro()
            const msg = MSG_STATUS[pkg.status] || `Status inválido: ${pkg.status}`
            setLocalizados(prev => [...prev, {
                barcode: codigo,
                client_name: (pkg.clients as any)?.name || '-',
                status: 'erro', msg
            }])
            setFeedback({ msg: `❌ ${codigo} — ${msg}`, tipo: 'erro' })
            setTimeout(() => setFeedback(null), 4000)
            inputRef.current?.focus()
            return
        }

        // Se o pacote está em outra base, transfere para a base atual
        const transferindo = pkg.company_id !== companyId

        if (transferindo) {
            // Evento de transferência na base de origem
            await supabase.from('package_events').insert({
                package_id: pkg.id,
                company_id: pkg.company_id,
                event_type: 'transferred',
                operator_id: operatorId,
                operator_name: operatorName,
                location: baseName,
                outcome_notes: `Transferido para ${baseName} via Localizar`
            })
            // Atualiza base e status
            await supabase.from('packages').update({
                status: 'in_warehouse',
                company_id: companyId
            }).eq('id', pkg.id)
        } else {
            await supabase.from('packages').update({ status: 'in_warehouse' }).eq('id', pkg.id)
        }

        // Evento de localização na base destino
        await supabase.from('package_events').insert({
            package_id: pkg.id,
            company_id: companyId,
            event_type: 'localized',
            operator_id: operatorId,
            operator_name: operatorName,
            location: baseName,
            outcome_notes: transferindo
                ? `Localizado e transferido de outra base para ${baseName}`
                : 'Localizado via módulo Localizar'
        })

        const clientName = (pkg.clients as any)?.name || '-'
        const msgOk = transferindo
            ? `🔍 ${codigo} — ${clientName} — Localizado e transferido para ${baseName}!`
            : `🔍 ${codigo} — ${clientName} — Localizado!`
        somSucesso()
        setLocalizados(prev => [...prev, {
            barcode: codigo, client_name: clientName,
            status: 'ok', msg: transferindo ? `Localizado e transferido para ${baseName}` : 'Localizado — voltou ao armazém'
        }])
        setFeedback({ msg: msgOk, tipo: 'ok' })
        setTimeout(() => setFeedback(null), 2000)
        inputRef.current?.focus()
    }

    const totalOk = localizados.filter(p => p.status === 'ok').length
    const totalErro = localizados.filter(p => p.status === 'erro').length

    return (
        <main className="min-h-screen p-6" style={{ backgroundColor: '#0f1923' }}>
            <div className="max-w-2xl mx-auto">
                <button onClick={() => router.push('/dashboard')}
                    className="text-slate-400 text-sm mb-6 hover:text-white">← Voltar</button>

                <h1 className="text-white font-black tracking-widest uppercase text-xl mb-1">
                    🔍 Localizar
                </h1>
                <p className="text-xs mb-2" style={{ color: '#00b4b4' }}>📍 {baseName}</p>
                <p className="text-slate-400 text-xs mb-6">
                    Bipe pacotes em extravio para localizá-los e devolvê-los ao armazém.
                    {podeRemoverExpedicao && <span style={{ color: '#ffb300' }}> · Permissão de remover expedição ativa.</span>}
                </p>

                <div className="rounded-lg p-4 mb-4" style={{ backgroundColor: '#1a2736' }}>
                    <input ref={inputRef} type="text" value={barcode}
                        onChange={e => setBarcode(e.target.value)}
                        onKeyDown={handleBipe}
                        placeholder="Bipe ou digite o código e pressione Enter"
                        className="w-full px-4 py-4 rounded text-white text-lg outline-none"
                        style={{ backgroundColor: '#0f1923', border: '2px solid #00b4b4' }}
                        autoFocus />
                    {buscando && <p className="text-xs text-slate-400 mt-2">Buscando...</p>}
                </div>

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

                {localizados.length > 0 && (
                    <>
                        <div className="flex gap-3 mb-4">
                            <div className="flex-1 rounded-lg p-3 text-center"
                                style={{ backgroundColor: '#0d2b1a', border: '1px solid #00e676' }}>
                                <p className="text-2xl font-black" style={{ color: '#00e676' }}>{totalOk}</p>
                                <p className="text-xs font-bold tracking-widest uppercase mt-1" style={{ color: '#00e676' }}>Localizados</p>
                            </div>
                            <div className="flex-1 rounded-lg p-3 text-center"
                                style={{
                                    backgroundColor: totalErro > 0 ? '#2b0d0d' : '#1a2736',
                                    border: `1px solid ${totalErro > 0 ? '#ff5252' : '#2a3f52'}`
                                }}>
                                <p className="text-2xl font-black"
                                    style={{ color: totalErro > 0 ? '#ff5252' : '#94a3b8' }}>
                                    {totalErro}
                                </p>
                                <p className="text-xs font-bold tracking-widest uppercase mt-1"
                                    style={{ color: totalErro > 0 ? '#ff5252' : '#94a3b8' }}>
                                    Erros
                                </p>
                            </div>
                        </div>

                        <div className="rounded-lg p-4" style={{ backgroundColor: '#1a2736' }}>
                            <p className="text-xs font-bold tracking-widest uppercase text-slate-400 mb-3">
                                Histórico desta sessão
                            </p>
                            <div className="flex flex-col gap-2 max-h-64 overflow-y-auto">
                                {[...localizados].reverse().map((p, i) => (
                                    <div key={i} className="flex items-center justify-between p-2 rounded"
                                        style={{ backgroundColor: '#0f1923' }}>
                                        <div>
                                            <p className="text-white font-mono text-sm">{p.barcode}</p>
                                            <p className="text-slate-400 text-xs">{p.client_name}</p>
                                        </div>
                                        <span className="text-xs font-bold text-right ml-2"
                                            style={{
                                                color: p.status === 'ok' ? '#00e676' : '#ff5252',
                                                maxWidth: '180px'
                                            }}>
                                            {p.status === 'ok' ? '🔍 Localizado' : `❌ ${p.msg}`}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </>
                )}
            </div>
        </main>
    )
}