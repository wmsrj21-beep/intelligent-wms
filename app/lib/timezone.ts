// Fuso horário de Brasília — UTC-3
const OFFSET_BRASILIA = -3

export function agoraBrasilia(): Date {
    const agora = new Date()
    agora.setHours(agora.getHours() + agora.getTimezoneOffset() / 60 + OFFSET_BRASILIA)
    return agora
}

export function formatDateInput(date?: Date): string {
    const d = date || agoraBrasilia()
    const ano = d.getFullYear()
    const mes = String(d.getMonth() + 1).padStart(2, '0')
    const dia = String(d.getDate()).padStart(2, '0')
    return `${ano}-${mes}-${dia}`
}

export function toISOStartBrasilia(data: string): string {
    // data = "2026-04-28" → início do dia em Brasília = UTC+3h
    return `${data}T03:00:00.000Z`
}

export function toISOEndBrasilia(data: string): string {
    // data = "2026-04-28" → fim do dia em Brasília = próximo dia UTC+3h - 1ms
    const [ano, mes, dia] = data.split('-').map(Number)
    const fimDia = new Date(Date.UTC(ano, mes - 1, dia + 1, 2, 59, 59, 999))
    return fimDia.toISOString()
}

export function formatDatetimeBrasilia(isoString: string): string {
    const d = new Date(isoString)
    return d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
}

export function formatDateBrasilia(isoString: string): string {
    const d = new Date(isoString)
    return d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })
}