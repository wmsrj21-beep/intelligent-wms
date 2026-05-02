'use client'

import { useState, useEffect } from 'react'
import { createClient } from '../lib/supabase'
import { useRouter } from 'next/navigation'
import * as XLSX from 'xlsx'

type PacoteDevolucao = {
    id: string
    barcode: string
    client_id: string
    client_name: string
    motivo: 'ausente_3x' | 'recusado'
    tentativas: number
    status: string
}

type GrupoDevolucao = {
    client_id: string
    client_name: string
    pacotes: PacoteDevolucao[]
}

export default function DevolucaoPage() {
    const router = useRouter()
    const supabase = createClient()

    const [companyId, setCompanyId] = useState('')
    const [operatorId, setOperatorId] = useState('')
    const [operatorName, setOperatorName] = useState('')
    const [baseName, setBaseName] = useState('')

    const [grupos, setGrupos] = useState<GrupoDevolucao[]>([])
    const [loading, setLoading] = useState(true)
    const [processando, setProcessando] = useState(false)
    const [selecionados, setSelecionados] = useState<Set<string>>(new Set())
    const [expandido, setExpandido] = useState<string | null>(null)
    const [sucesso, setSucesso] = useState('')

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

            await carregarElegiveis(userData.company_id)
        }
        init()
    }, [])

    async function carregarElegiveis(cid: string) {
        setLoading(true)

        // Buscar pacotes unsuccessful
        const { data: pkgsUnsuccessful } = await supabase
            .from('packages')
            .select('id, barcode, tentativas, clients(id, name)')
            .eq('company_id', cid)
            .eq('status', 'unsuccessful')

        // Buscar pacotes com incidente de recusado (status incident)
        const { data: incidentesRecusado } = await supabase
            .from('incidents')
            .select('package_id, packages(id, barcode, status, tentativas, clients(id, name))')
            .eq('company_id', cid)
            .eq('type', 'cliente_recusou')
            .eq('status', 'aberto')

        const elegiveis: PacoteDevolucao[] = []

        // Ausentes com 3+ tentativas
        for (const pkg of (pkgsUnsuccessful || [])) {
            const tent = pkg.tentativas || 0
            if (tent >= 3) {
                elegiveis.push({
                    id: pkg.id,
                    barcode: pkg.barcode,
                    client_id: (pkg.clients as any)?.id || '',
                    client_name: (pkg.clients as any)?.name || '-',
                    motivo: 'ausente_3x',
                    tentativas: tent,
                    status: 'unsuccessful'
                })
            }
        }

        // Recusados (incidente tipo cliente_recusou)
        for (const inc of (incidentesRecusado || [])) {
            const pkg = (inc.packages as any)
            if (!pkg || pkg.status === 'devolvido_cliente') continue
            const jaAdicionado = elegiveis.find(e => e.id === pkg.id)
            if (!jaAdicionado) {
                elegiveis.push({
                    id: pkg.id,
                    barcode: pkg.barcode,
                    client_id: pkg.clients?.id || '',
                    client_name: pkg.clients?.name || '-',
                    motivo: 'recusado',
                    tentativas: pkg.tentativas || 0,
                    status: pkg.status
                })
            }
        }

        // Agrupar por cliente
        const agrupado: Record<string, GrupoDevolucao> = {}
        for (const pkg of elegiveis) {
            if (!agrupado[pkg.client_id]) {
                agrupado[pkg.client_id] = {
                    client_id: pkg.client_id,
                    client_name: pkg.client_name,
                    pacotes: []
                }
            }
            agrupado[pkg.client_id].pacotes.push(pkg)
        }

        setGrupos(Object.values(agrupado))
        setLoading(false)
    }

    function toggleSelecionado(id: string) {
        setSelecionados(prev => {
            const novo = new Set(prev)
            if (novo.has(id)) novo.delete(id)
            else novo.add(id)
            return novo
        })
    }

    function selecionarTodosDoCliente(clientId: string) {
        const grupo = grupos.find(g => g.client_id === clientId)
        if (!grupo) return
        const todosIds = grupo.pacotes.map(p => p.id)
        const todosSelecionados = todosIds.every(id => selecionados.has(id))
        setSelecionados(prev => {
            const novo = new Set(prev)
            if (todosSelecionados) {
                todosIds.forEach(id => novo.delete(id))
            } else {
                todosIds.forEach(id => novo.add(id))
            }
            return novo
        })
    }

    async function confirmarDevolucao() {
        if (selecionados.size === 0) return
        const confirmar = window.confirm(
            `Confirma a devolução de ${selecionados.size} pacote(s) ao cliente?\n\nEsta ação é irreversível.`
        )
        if (!confirmar) return

        setProcessando(true)

        // Agrupar selecionados por cliente para criar romaneios
        const porCliente: Record<string, { client_id: string; client_name: string; pacotes: PacoteDevolucao[] }> = {}

        for (const grupo of grupos) {
            for (const pkg of grupo.pacotes) {
                if (!selecionados.has(pkg.id)) continue
                if (!porCliente[grupo.client_id]) {
                    porCliente[grupo.client_id] = {
                        client_id: grupo.client_id,
                        client_name: grupo.client_name,
                        pacotes: []
                    }
                }
                porCliente[grupo.client_id].pacotes.push(pkg)
            }
        }

        for (const [clientId, dados] of Object.entries(porCliente)) {
            // Criar registro de devolução
            const { data: dev } = await supabase.from('devolucoes').insert({
                company_id: companyId,
                client_id: clientId || null,
                client_name: dados.client_name,
                operator_id: operatorId,
                operator_name: operatorName,
                status: 'enviado',
                total_pacotes: dados.pacotes.length,
                enviado_at: new Date().toISOString()
            }).select().single()

            if (!dev) continue

            // Criar itens e atualizar pacotes
            for (const pkg of dados.pacotes) {
                await supabase.from('devolucao_items').insert({
                    devolucao_id: dev.id,
                    package_id: pkg.id,
                    barcode: pkg.barcode,
                    motivo: pkg.motivo
                })

                await supabase.from('packages')
                    .update({ status: 'devolvido_cliente' })
                    .eq('id', pkg.id)

                await supabase.from('package_events').insert({
                    package_id: pkg.id,
                    company_id: companyId,
                    event_type: 'devolucao_cliente',
                    operator_id: operatorId,
                    operator_name: operatorName,
                    outcome_notes: `Devolvido a ${dados.client_name}`
                })
            }

            // Imprimir romaneio automaticamente
            imprimirRomaneio(dados.client_name, dados.pacotes)
        }

        setSelecionados(new Set())
        setProcessando(false)
        setSucesso(`${selecionados.size} pacote(s) marcados como devolvidos ao cliente.`)
        setTimeout(() => setSucesso(''), 4000)
        await carregarElegiveis(companyId)
    }

    function imprimirRomaneio(clientName: string, pacotes: PacoteDevolucao[]) {
        const dataHora = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })

        const conteudo = `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Romaneio de Devolução</title>
<style>
  body { font-family: Arial, sans-serif; padding: 40px; max-width: 700px; margin: 0 auto; color: #000; }
  h1 { font-size: 18px; text-align: center; margin-bottom: 4px; }
  h2 { font-size: 14px; text-align: center; color: #555; margin-bottom: 24px; }
  .info { border: 1px solid #ccc; padding: 12px; margin-bottom: 20px; border-radius: 4px; }
  .info p { margin: 4px 0; font-size: 13px; }
  .info strong { display: inline-block; width: 140px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
  th { background: #f0f0f0; padding: 8px; text-align: left; font-size: 12px; border: 1px solid #ccc; }
  td { padding: 7px 8px; font-size: 12px; border: 1px solid #ccc; }
  .motivo-ausente { color: #cc6600; }
  .motivo-recusado { color: #cc0000; }
  .assinaturas { display: flex; gap: 40px; margin-top: 60px; }
  .assinatura { flex: 1; text-align: center; }
  .assinatura .linha { border-top: 1px solid #000; margin-bottom: 6px; }
  .assinatura p { font-size: 12px; margin: 2px 0; }
  .rodape { margin-top: 30px; font-size: 11px; color: #666; text-align: center; }
  @media print { body { padding: 20px; } }
</style>
</head>
<body>
<h1>Intelligent WMS</h1>
<h2>Romaneio de Devolução ao Embarcador</h2>

<div class="info">
  <p><strong>Base:</strong> ${baseName}</p>
  <p><strong>Data/Hora:</strong> ${dataHora}</p>
  <p><strong>Cliente / Embarcador:</strong> ${clientName}</p>
  <p><strong>Total de Pacotes:</strong> ${pacotes.length}</p>
  <p><strong>Responsável:</strong> ${operatorName}</p>
</div>

<table>
  <thead>
    <tr>
      <th>#</th>
      <th>Código do Pacote</th>
      <th>Motivo da Devolução</th>
      <th>Tentativas</th>
    </tr>
  </thead>
  <tbody>
    ${pacotes.map((p, i) => `
    <tr>
      <td>${i + 1}</td>
      <td><strong>${p.barcode}</strong></td>
      <td class="${p.motivo === 'recusado' ? 'motivo-recusado' : 'motivo-ausente'}">
        ${p.motivo === 'ausente_3x' ? '🔄 Ausente — 3 tentativas' : '🚫 Recusado pelo destinatário'}
      </td>
      <td>${p.tentativas}x</td>
    </tr>`).join('')}
  </tbody>
</table>

<p style="font-size: 12px; margin-bottom: 40px;">
  Total de pacotes devolvidos: <strong>${pacotes.length}</strong>
</p>

<div class="assinaturas">
  <div class="assinatura">
    <div class="linha"></div>
    <p><strong>${operatorName}</strong></p>
    <p>Responsável pela Devolução</p>
    <p>${baseName}</p>
  </div>
  <div class="assinatura">
    <div class="linha"></div>
    <p><strong>${clientName}</strong></p>
    <p>Representante do Embarcador</p>
    <p>Recebido em: ${dataHora}</p>
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

    function exportarExcel() {
        const rows: any[] = []
        for (const grupo of grupos) {
            for (const pkg of grupo.pacotes) {
                if (!selecionados.has(pkg.id)) continue
                rows.push({
                    'Código': pkg.barcode,
                    'Cliente': pkg.client_name,
                    'Motivo': pkg.motivo === 'ausente_3x' ? 'Ausente 3x' : 'Recusado',
                    'Tentativas': pkg.tentativas,
                })
            }
        }
        if (rows.length === 0) return
        const wb = XLSX.utils.book_new()
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Devolução')
        XLSX.writeFile(wb, `devolucao_${new Date().toISOString().slice(0, 10)}.xlsx`)
    }

    const totalElegiveis = grupos.reduce((a, g) => a + g.pacotes.length, 0)

    return (
        <main className="min-h-screen p-6" style={{ backgroundColor: '#0f1923' }}>
            <div className="max-w-3xl mx-auto">
                <button onClick={() => router.push('/dashboard')}
                    className="text-slate-400 text-sm mb-6 hover:text-white">← Voltar</button>

                <div className="flex items-center justify-between mb-6">
                    <div>
                        <h1 className="text-white font-black tracking-widest uppercase text-xl">
                            📦 Devolução ao Embarcador
                        </h1>
                        <p className="text-slate-400 text-xs mt-1">{baseName}</p>
                    </div>
                    {selecionados.size > 0 && (
                        <div className="flex gap-2">
                            <button onClick={exportarExcel}
                                className="px-4 py-2 rounded font-black tracking-widest uppercase text-sm"
                                style={{ backgroundColor: '#1a2736', color: '#00b4b4', border: '1px solid #00b4b4' }}>
                                ⬇️ Excel
                            </button>
                            <button onClick={confirmarDevolucao} disabled={processando}
                                className="px-4 py-2 rounded font-black tracking-widest uppercase text-sm disabled:opacity-50"
                                style={{ backgroundColor: '#c0392b', color: 'white' }}>
                                {processando ? 'Processando...' : `Devolver (${selecionados.size})`}
                            </button>
                        </div>
                    )}
                </div>

                {sucesso && (
                    <div className="rounded p-3 mb-4 text-sm font-bold"
                        style={{ backgroundColor: '#0d2b1a', color: '#00e676', border: '1px solid #00e676' }}>
                        ✅ {sucesso}
                    </div>
                )}

                {loading ? (
                    <p className="text-slate-400 text-sm">Carregando...</p>
                ) : totalElegiveis === 0 ? (
                    <div className="rounded-lg p-8 text-center" style={{ backgroundColor: '#1a2736' }}>
                        <p className="text-2xl mb-2">✅</p>
                        <p className="text-white font-bold">Nenhum pacote elegível para devolução</p>
                        <p className="text-slate-400 text-sm mt-1">
                            Aparecem aqui pacotes com 3+ tentativas ou marcados como recusados
                        </p>
                    </div>
                ) : (
                    <div className="flex flex-col gap-4">
                        {grupos.map(grupo => {
                            const todosSelecionados = grupo.pacotes.every(p => selecionados.has(p.id))
                            const algunsSelecionados = grupo.pacotes.some(p => selecionados.has(p.id))

                            return (
                                <div key={grupo.client_id} className="rounded-lg overflow-hidden"
                                    style={{ backgroundColor: '#1a2736' }}>

                                    {/* Header do cliente */}
                                    <div className="flex items-center justify-between p-4">
                                        <div className="flex items-center gap-3">
                                            <button
                                                onClick={() => selecionarTodosDoCliente(grupo.client_id)}
                                                className="w-6 h-6 rounded flex items-center justify-center text-xs font-bold outline-none"
                                                style={{
                                                    backgroundColor: todosSelecionados ? '#00b4b4' : algunsSelecionados ? '#2a3f52' : '#0f1923',
                                                    border: `2px solid ${todosSelecionados ? '#00b4b4' : '#2a3f52'}`
                                                }}>
                                                {todosSelecionados ? '✓' : algunsSelecionados ? '−' : ''}
                                            </button>
                                            <div>
                                                <p className="text-white font-bold">{grupo.client_name}</p>
                                                <p className="text-slate-400 text-xs">
                                                    {grupo.pacotes.length} pacote{grupo.pacotes.length !== 1 ? 's' : ''} elegíveis
                                                </p>
                                            </div>
                                        </div>
                                        <button
                                            onClick={() => setExpandido(expandido === grupo.client_id ? null : grupo.client_id)}
                                            className="px-3 py-1 rounded text-xs font-bold outline-none"
                                            style={{ backgroundColor: '#0f1923', color: '#94a3b8', border: '1px solid #2a3f52' }}>
                                            {expandido === grupo.client_id ? '▲' : '▼'}
                                        </button>
                                    </div>

                                    {/* Lista de pacotes */}
                                    {expandido === grupo.client_id && (
                                        <div className="border-t px-4 pb-4" style={{ borderColor: '#0f1923' }}>
                                            <div className="flex flex-col gap-2 mt-3">
                                                {grupo.pacotes.map(pkg => (
                                                    <div key={pkg.id}
                                                        onClick={() => toggleSelecionado(pkg.id)}
                                                        className="flex items-center justify-between p-3 rounded cursor-pointer"
                                                        style={{
                                                            backgroundColor: selecionados.has(pkg.id) ? '#0d1f2b' : '#0f1923',
                                                            border: selecionados.has(pkg.id) ? '1px solid #00b4b4' : '1px solid transparent'
                                                        }}>
                                                        <div className="flex items-center gap-3">
                                                            <div className="w-5 h-5 rounded flex items-center justify-center text-xs"
                                                                style={{
                                                                    backgroundColor: selecionados.has(pkg.id) ? '#00b4b4' : '#1a2736',
                                                                    border: `2px solid ${selecionados.has(pkg.id) ? '#00b4b4' : '#2a3f52'}`
                                                                }}>
                                                                {selecionados.has(pkg.id) && '✓'}
                                                            </div>
                                                            <div>
                                                                <p className="text-white font-mono text-sm">{pkg.barcode}</p>
                                                                <p className="text-xs mt-0.5"
                                                                    style={{ color: pkg.motivo === 'recusado' ? '#ff5252' : '#ffb300' }}>
                                                                    {pkg.motivo === 'ausente_3x'
                                                                        ? `🔄 Ausente — ${pkg.tentativas} tentativas`
                                                                        : '🚫 Recusado pelo destinatário'}
                                                                </p>
                                                            </div>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )
                        })}
                    </div>
                )}
            </div>
        </main>
    )
}