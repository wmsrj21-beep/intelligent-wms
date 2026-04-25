'use client'

import { useState, useEffect, useRef } from 'react'
import { createClient } from '../lib/supabase'
import { useRouter } from 'next/navigation'

type MotoristaRetorno = {
    motorista_id: string
    motorista_nome: string
    placa: string
    pacotes_pendentes: PacotePendente[]
}

type PacotePendente = {
    id: string
    barcode: string
    client_name: string
}

type PacoteBipado = {
    barcode: string
    status: 'devolvido' | 'erro'
    msg: string
}

export default function RetornoPage() {
    const router = useRouter()
    const supabase = createClient()
    const inputRef = useRef<HTMLInputElement>(null)

    const [companyId, setCompanyId] = useState('')
    const [operatorId, setOperatorId] = useState('')
    const [operatorName, setOperatorName] = useState('')
    const [baseName, setBaseName] = useState('')

    const [fase, setFase] = useState<'lista' | 'bipando' | 'resultado'>('lista')
    const [motoristasPendentes, setMotoristasPendentes] = useState<MotoristaRetorno[]>([])
    const [motoristaSelecionado, setMotoristaSelecionado] = useState<MotoristaRetorno | null>(null)

    const [barcode, setBarcode] = useState('')
    const [bipados, setBipados] = useState<PacoteBipado[]>([])
    const [feedback, setFeedback] = useState<{ msg: string; tipo: 'ok' | 'erro' | 'alerta' } | null>(null)
    const [finalizando, setFinalizando] = useState(false)
    const [loading, setLoading] = useState(true)

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

            const { data: companyData } = await supabase
                .from('companies').select('name, code').eq('id', userData.company_id).single()
            if (companyData) {
                setBaseName(companyData.code ? `${companyData.code} — ${companyData.name}` : companyData.name)
            }

            await carregarPendentes(userData.company_id)
        }
        init()
    }, [])

    async function carregarPendentes(cid: string) {
        setLoading(true)

        const { data: pkgs } = await supabase
            .from('packages')
            .select('id, barcode, clients(name)')
            .eq('company_id', cid)
            .eq('status', 'unsuccessful')

        if (!pkgs || pkgs.length === 0) {
            setMotoristasPendentes([])
            setLoading(false)
            return
        }

        const pkgIds = pkgs.map((p: any) => p.id)

        const { data: eventos } = await supabase
            .from('package_events')
            .select('package_id, driver_id, driver_name, drivers(license_plate)')
            .eq('company_id', cid)
            .eq('event_type', 'dispatched')
            .in('package_id', pkgIds)

        if (!eventos) { setLoading(false); return }

        const agrupado: Record<string, MotoristaRetorno> = {}

        for (const ev of eventos) {
            if (!ev.driver_id) continue
            const pkg = pkgs.find((p: any) => p.id === ev.package_id)
            if (!pkg) continue

            if (!agrupado[ev.driver_id]) {
                agrupado[ev.driver_id] = {
                    motorista_id: ev.driver_id,
                    motorista_nome: ev.driver_name || '-',
                    placa: (ev.drivers as any)?.license_plate || '-',
                    pacotes_pendentes: []
                }
            }

            const jaAdicionado = agrupado[ev.driver_id].pacotes_pendentes
                .find(p => p.id === pkg.id)
            if (!jaAdicionado) {
                agrupado[ev.driver_id].pacotes_pendentes.push({
                    id: pkg.id,
                    barcode: pkg.barcode,
                    client_name: (pkg.clients as any)?.name || '-'
                })
            }
        }

        setMotoristasPendentes(Object.values(agrupado))
        setLoading(false)
    }

    function selecionarMotorista(mot: MotoristaRetorno) {
        setMotoristaSelecionado(mot)
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
            setFeedback({ msg: `⚠️ ${codigo} já foi bipado`, tipo: 'alerta' })
            setTimeout(() => setFeedback(null), 2000)
            inputRef.current?.focus()
            return
        }

        const pacote = motoristaSelecionado?.pacotes_pendentes.find(p => p.barcode === codigo)

        if (!pacote) {
            setBipados(prev => [...prev, { barcode: codigo, status: 'erro', msg: 'Não estava na lista de pendentes' }])
            setFeedback({ msg: `❌ ${codigo} — não estava na lista`, tipo: 'erro' })
            setTimeout(() => setFeedback(null), 2000)
            inputRef.current?.focus()
            return
        }

        setBipados(prev => [...prev, { barcode: codigo, status: 'devolvido', msg: 'Devolvido' }])
        setFeedback({ msg: `✅ ${codigo} — devolvido`, tipo: 'ok' })
        setTimeout(() => setFeedback(null), 1500)
        inputRef.current?.focus()
    }

    async function finalizarRetorno() {
        if (!motoristaSelecionado) return
        setFinalizando(true)

        const devolvidos = bipados.filter(b => b.status === 'devolvido').map(b => b.barcode)

        for (const pkg of motoristaSelecionado.pacotes_pendentes) {
            if (devolvidos.includes(pkg.barcode)) {
                await supabase.from('packages')
                    .update({ status: 'in_warehouse' })
                    .eq('id', pkg.id)

                await supabase.from('package_events').insert({
                    package_id: pkg.id,
                    company_id: companyId,
                    event_type: 'returned',
                    outcome: 'returned',
                    operator_id: operatorId,
                    operator_name: operatorName,
                    driver_id: motoristaSelecionado.motorista_id,
                    driver_name: motoristaSelecionado.motorista_nome,
                })
            }
        }

        setFinalizando(false)
        setFase('resultado')
    }

    function imprimirTermo() {
        const devolvidos = bipados.filter(b => b.status === 'devolvido').map(b => b.barcode)
        const naoDevolvidos = motoristaSelecionado?.pacotes_pendentes
            .filter(p => !devolvidos.includes(p.barcode)) || []
        const dataHora = new Date().toLocaleString('pt-BR')

        const conteudo = `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Termo de Retorno</title>
<style>
  body { font-family: Arial, sans-serif; padding: 40px; max-width: 700px; margin: 0 auto; color: #000; }
  h1 { font-size: 18px; text-align: center; margin-bottom: 4px; }
  h2 { font-size: 14px; text-align: center; color: #555; margin-bottom: 24px; }
  .info { border: 1px solid #ccc; padding: 12px; margin-bottom: 20px; border-radius: 4px; }
  .info p { margin: 4px 0; font-size: 13px; }
  .info strong { display: inline-block; width: 120px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
  th { background: #f0f0f0; padding: 8px; text-align: left; font-size: 12px; border: 1px solid #ccc; }
  td { padding: 7px 8px; font-size: 12px; border: 1px solid #ccc; }
  .status-ok { color: #006600; font-weight: bold; }
  .status-falta { color: #cc0000; font-weight: bold; }
  .assinaturas { display: flex; gap: 40px; margin-top: 60px; }
  .assinatura { flex: 1; text-align: center; }
  .assinatura .linha { border-top: 1px solid #000; margin-bottom: 6px; }
  .assinatura p { font-size: 12px; margin: 2px 0; }
  .rodape { margin-top: 30px; font-size: 11px; color: #666; text-align: center; }
  .aviso { background: #fff3cd; border: 1px solid #ffc107; padding: 10px; border-radius: 4px; margin-bottom: 20px; font-size: 12px; }
  @media print { body { padding: 20px; } }
</style>
</head>
<body>

<h1>Intelligent WMS</h1>
<h2>Termo de Retorno de Rua</h2>

<div class="info">
  <p><strong>Base:</strong> ${baseName}</p>
  <p><strong>Data/Hora:</strong> ${dataHora}</p>
  <p><strong>Motorista:</strong> ${motoristaSelecionado?.motorista_nome}</p>
  <p><strong>Placa:</strong> ${motoristaSelecionado?.placa}</p>
  <p><strong>Responsável:</strong> ${operatorName}</p>
</div>

${naoDevolvidos.length > 0 ? `
<div class="aviso">
  ⚠️ <strong>Atenção:</strong> ${naoDevolvidos.length} pacote(s) não foram devolvidos. 
  O motorista está ciente e se responsabiliza pelos itens listados abaixo.
</div>
` : ''}

<table>
  <thead>
    <tr>
      <th>#</th>
      <th>Código do Pacote</th>
      <th>Cliente</th>
      <th>Status</th>
    </tr>
  </thead>
  <tbody>
    ${motoristaSelecionado?.pacotes_pendentes.map((p, i) => {
            const devolvido = devolvidos.includes(p.barcode)
            return `
      <tr>
        <td>${i + 1}</td>
        <td>${p.barcode}</td>
        <td>${p.client_name}</td>
        <td class="${devolvido ? 'status-ok' : 'status-falta'}">${devolvido ? '✓ Devolvido' : '✗ Não Devolvido'}</td>
      </tr>`
        }).join('')}
  </tbody>
</table>

<p style="font-size: 12px; margin-bottom: 40px;">
  Total de pacotes: <strong>${motoristaSelecionado?.pacotes_pendentes.length}</strong> &nbsp;|&nbsp;
  Devolvidos: <strong class="status-ok">${devolvidos.length}</strong> &nbsp;|&nbsp;
  Não devolvidos: <strong class="status-falta">${naoDevolvidos.length}</strong>
</p>

<div class="assinaturas">
  <div class="assinatura">
    <div class="linha"></div>
    <p><strong>${motoristaSelecionado?.motorista_nome}</strong></p>
    <p>Motorista</p>
    <p>Placa: ${motoristaSelecionado?.placa}</p>
  </div>
  <div class="assinatura">
    <div class="linha"></div>
    <p><strong>${operatorName}</strong></p>
    <p>Responsável / Operador</p>
    <p>${baseName}</p>
  </div>
</div>

<div class="rodape">
  Documento gerado automaticamente pelo Intelligent WMS em ${dataHora}
</div>

</body>
</html>`

        const janela = window.open('', '_blank')
        if (janela) {
            janela.document.write(conteudo)
            janela.document.close()
            janela.focus()
            setTimeout(() => janela.print(), 500)
        }
    }

    const devolvidos = bipados.filter(b => b.status === 'devolvido')
    const naoDevolvidos = motoristaSelecionado?.pacotes_pendentes
        .filter(p => !devolvidos.map(d => d.barcode).includes(p.barcode)) || []
    const progresso = motoristaSelecionado
        ? Math.round((devolvidos.length / motoristaSelecionado.pacotes_pendentes.length) * 100)
        : 0

    // ─── LISTA ───
    if (fase === 'lista') return (
        <main className="min-h-screen p-6" style={{ backgroundColor: '#0f1923' }}>
            <div className="max-w-2xl mx-auto">
                <button onClick={() => router.push('/dashboard')}
                    className="text-slate-400 text-sm mb-6 hover:text-white">← Voltar</button>

                <h1 className="text-white font-black tracking-widest uppercase text-xl mb-2">
                    ↩️ Retorno de Rua
                </h1>
                <p className="text-slate-400 text-xs mb-6">
                    Selecione o motorista que está retornando para registrar a devolução dos pacotes.
                </p>

                {loading ? (
                    <p className="text-slate-400 text-sm">Carregando...</p>
                ) : motoristasPendentes.length === 0 ? (
                    <div className="rounded-lg p-8 text-center" style={{ backgroundColor: '#1a2736' }}>
                        <p className="text-2xl mb-2">✅</p>
                        <p className="text-white font-bold">Nenhum motorista com pendência</p>
                        <p className="text-slate-400 text-sm mt-1">Todos os pacotes foram devolvidos</p>
                    </div>
                ) : (
                    <div className="flex flex-col gap-3">
                        {motoristasPendentes.map(mot => (
                            <button key={mot.motorista_id}
                                onClick={() => selecionarMotorista(mot)}
                                className="rounded-lg p-5 text-left hover:opacity-80 outline-none"
                                style={{ backgroundColor: '#1a2736', border: '1px solid #ff5252' }}>
                                <div className="flex items-center justify-between">
                                    <div>
                                        <p className="text-white font-bold">{mot.motorista_nome}</p>
                                        <p className="text-slate-400 text-xs">{mot.placa}</p>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-2xl font-black" style={{ color: '#ff5252' }}>
                                            {mot.pacotes_pendentes.length}
                                        </p>
                                        <p className="text-xs font-bold" style={{ color: '#ff5252' }}>
                                            pendente{mot.pacotes_pendentes.length !== 1 ? 's' : ''}
                                        </p>
                                    </div>
                                </div>
                                <div className="mt-3 flex flex-wrap gap-1">
                                    {mot.pacotes_pendentes.slice(0, 5).map(p => (
                                        <span key={p.id} className="px-2 py-0.5 rounded text-xs font-mono"
                                            style={{ backgroundColor: '#2b0d0d', color: '#ff5252' }}>
                                            {p.barcode}
                                        </span>
                                    ))}
                                    {mot.pacotes_pendentes.length > 5 && (
                                        <span className="px-2 py-0.5 rounded text-xs text-slate-400">
                                            +{mot.pacotes_pendentes.length - 5} mais
                                        </span>
                                    )}
                                </div>
                            </button>
                        ))}
                    </div>
                )}
            </div>
        </main>
    )

    // ─── BIPANDO ───
    if (fase === 'bipando') return (
        <main className="min-h-screen p-6" style={{ backgroundColor: '#0f1923' }}>
            <div className="max-w-2xl mx-auto">
                <button onClick={() => setFase('lista')}
                    className="text-slate-400 text-sm mb-6 hover:text-white">← Voltar</button>

                <h1 className="text-white font-black tracking-widest uppercase text-xl mb-1">
                    ↩️ Recebendo Retorno
                </h1>
                <p className="text-slate-400 text-sm mb-6">
                    {motoristaSelecionado?.motorista_nome} — {motoristaSelecionado?.placa}
                </p>

                {/* Progresso */}
                <div className="rounded-lg p-4 mb-4" style={{ backgroundColor: '#1a2736' }}>
                    <div className="flex justify-between text-xs mb-2">
                        <span className="text-slate-400">
                            {devolvidos.length} de {motoristaSelecionado?.pacotes_pendentes.length} devolvidos
                        </span>
                        <span className="font-bold" style={{ color: '#00b4b4' }}>{progresso}%</span>
                    </div>
                    <div className="w-full rounded-full h-3" style={{ backgroundColor: '#0f1923' }}>
                        <div className="h-3 rounded-full transition-all duration-300"
                            style={{ width: `${progresso}%`, backgroundColor: '#00b4b4' }} />
                    </div>
                    <div className="flex gap-4 mt-2 text-xs">
                        <span style={{ color: '#00e676' }}>✅ {devolvidos.length} devolvidos</span>
                        <span style={{ color: '#ff5252' }}>❌ {naoDevolvidos.length} pendentes</span>
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

                {feedback && (
                    <div className="rounded p-3 mb-4 text-sm font-bold"
                        style={{
                            backgroundColor: feedback.tipo === 'ok' ? '#0d2b1a' : feedback.tipo === 'alerta' ? '#2b1f0d' : '#2b0d0d',
                            color: feedback.tipo === 'ok' ? '#00e676' : feedback.tipo === 'alerta' ? '#ffb300' : '#ff5252',
                            border: `1px solid ${feedback.tipo === 'ok' ? '#00e676' : feedback.tipo === 'alerta' ? '#ffb300' : '#ff5252'}`
                        }}>
                        {feedback.msg}
                    </div>
                )}

                {/* Pendentes */}
                <div className="rounded-lg p-4 mb-4" style={{ backgroundColor: '#1a2736' }}>
                    <p className="text-xs font-bold tracking-widest uppercase text-slate-400 mb-3">
                        Pacotes Pendentes — {naoDevolvidos.length}
                    </p>
                    <div className="flex flex-col gap-1 max-h-48 overflow-y-auto">
                        {naoDevolvidos.map(p => (
                            <div key={p.id} className="flex justify-between text-xs p-2 rounded"
                                style={{ backgroundColor: '#0f1923' }}>
                                <span className="text-white font-mono">{p.barcode}</span>
                                <span className="text-slate-400">{p.client_name}</span>
                            </div>
                        ))}
                        {naoDevolvidos.length === 0 && (
                            <p className="text-slate-500 text-sm">Todos devolvidos! 🎉</p>
                        )}
                    </div>
                </div>

                <button onClick={finalizarRetorno} disabled={finalizando}
                    className="w-full py-3 rounded font-black tracking-widest uppercase text-white text-sm disabled:opacity-50"
                    style={{ backgroundColor: naoDevolvidos.length > 0 ? '#c0392b' : '#00b4b4' }}>
                    {finalizando ? 'Finalizando...' : naoDevolvidos.length > 0
                        ? `Finalizar (${naoDevolvidos.length} não devolvidos)`
                        : 'Finalizar — Tudo Devolvido ✅'}
                </button>
            </div>
        </main>
    )

    // ─── RESULTADO ───
    return (
        <main className="min-h-screen p-6" style={{ backgroundColor: '#0f1923' }}>
            <div className="max-w-lg mx-auto">
                <h1 className="text-white font-black tracking-widest uppercase text-xl mb-6">
                    ↩️ Retorno Finalizado
                </h1>

                <div className="grid grid-cols-3 gap-3 mb-6">
                    <div className="rounded-lg p-4 text-center" style={{ backgroundColor: '#0d2b1a', border: '1px solid #00e676' }}>
                        <p className="text-2xl font-black" style={{ color: '#00e676' }}>{devolvidos.length}</p>
                        <p className="text-xs font-bold tracking-widest uppercase mt-1" style={{ color: '#00e676' }}>Devolvidos</p>
                    </div>
                    <div className="rounded-lg p-4 text-center"
                        style={{
                            backgroundColor: naoDevolvidos.length > 0 ? '#2b0d0d' : '#1a2736',
                            border: `1px solid ${naoDevolvidos.length > 0 ? '#ff5252' : '#2a3f52'}`
                        }}>
                        <p className="text-2xl font-black"
                            style={{ color: naoDevolvidos.length > 0 ? '#ff5252' : '#94a3b8' }}>
                            {naoDevolvidos.length}
                        </p>
                        <p className="text-xs font-bold tracking-widest uppercase mt-1"
                            style={{ color: naoDevolvidos.length > 0 ? '#ff5252' : '#94a3b8' }}>
                            Não Devolvidos
                        </p>
                    </div>
                    <div className="rounded-lg p-4 text-center" style={{ backgroundColor: '#1a2736', border: '1px solid #2a3f52' }}>
                        <p className="text-2xl font-black text-white">
                            {motoristaSelecionado?.pacotes_pendentes.length}
                        </p>
                        <p className="text-xs font-bold tracking-widest uppercase mt-1 text-slate-400">Total</p>
                    </div>
                </div>

                {naoDevolvidos.length > 0 && (
                    <div className="rounded-lg p-4 mb-4"
                        style={{ backgroundColor: '#2b0d0d', border: '1px solid #ff5252' }}>
                        <p className="text-xs font-bold tracking-widest uppercase mb-2" style={{ color: '#ff5252' }}>
                            ⚠️ Pacotes não devolvidos — motorista bloqueado até devolução
                        </p>
                        <div className="flex flex-col gap-1">
                            {naoDevolvidos.map(p => (
                                <div key={p.id} className="flex justify-between text-xs p-2 rounded"
                                    style={{ backgroundColor: '#0f1923' }}>
                                    <span className="text-white font-mono">{p.barcode}</span>
                                    <span className="text-slate-400">{p.client_name}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                <div className="flex flex-col gap-3">
                    <button onClick={imprimirTermo}
                        className="w-full py-3 rounded font-black tracking-widest uppercase text-white text-sm"
                        style={{ backgroundColor: '#00b4b4' }}>
                        🖨️ Imprimir Termo de Retorno
                    </button>
                    <button onClick={() => { setFase('lista'); carregarPendentes(companyId) }}
                        className="w-full py-3 rounded font-black tracking-widest uppercase text-white text-sm"
                        style={{ backgroundColor: '#1a2736', border: '1px solid #2a3f52' }}>
                        Novo Retorno
                    </button>
                    <button onClick={() => router.push('/dashboard')}
                        className="w-full py-3 rounded font-black tracking-widest uppercase text-white text-sm"
                        style={{ backgroundColor: '#1a2736', border: '1px solid #2a3f52' }}>
                        Dashboard
                    </button>
                </div>
            </div>
        </main>
    )
}