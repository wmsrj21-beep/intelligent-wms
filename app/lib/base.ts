// Utilitário de base global — persiste no localStorage
// Usado por todos os módulos para saber qual base está selecionada

const BASE_KEY = 'wms_base_selecionada'

export function getBaseSelecionada(): string | null {
    if (typeof window === 'undefined') return null
    return localStorage.getItem(BASE_KEY)
}

export function setBaseSelecionada(baseId: string): void {
    if (typeof window === 'undefined') return
    localStorage.setItem(BASE_KEY, baseId)
}