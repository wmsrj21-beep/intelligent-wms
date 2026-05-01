// Sons gerados via Web Audio API — sem arquivos externos

function createAudioContext(): AudioContext | null {
    try {
        return new (window.AudioContext || (window as any).webkitAudioContext)()
    } catch {
        return null
    }
}

function beep(
    frequency: number,
    duration: number,
    volume: number,
    type: OscillatorType = 'sine'
): void {
    const ctx = createAudioContext()
    if (!ctx) return

    const oscillator = ctx.createOscillator()
    const gainNode = ctx.createGain()

    oscillator.connect(gainNode)
    gainNode.connect(ctx.destination)

    oscillator.frequency.value = frequency
    oscillator.type = type
    gainNode.gain.setValueAtTime(volume, ctx.currentTime)
    gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration)

    oscillator.start(ctx.currentTime)
    oscillator.stop(ctx.currentTime + duration)
}

// ✅ Sucesso — bipe agudo curto (leitura OK)
export function somSucesso(): void {
    beep(880, 0.15, 0.3, 'sine')
}

// ❌ Erro — bipe grave duplo
export function somErro(): void {
    beep(220, 0.2, 0.4, 'square')
    setTimeout(() => beep(180, 0.25, 0.4, 'square'), 200)
}

// ⚠️ Alerta — bipe médio
export function somAlerta(): void {
    beep(440, 0.2, 0.3, 'triangle')
}

// 🔍 Localizado — dois bipes ascendentes
export function somLocalizado(): void {
    beep(660, 0.12, 0.3, 'sine')
    setTimeout(() => beep(880, 0.15, 0.3, 'sine'), 130)
}

// 🔄 Transferido — três bipes curtos
export function somTransferido(): void {
    beep(660, 0.1, 0.25, 'sine')
    setTimeout(() => beep(660, 0.1, 0.25, 'sine'), 130)
    setTimeout(() => beep(880, 0.15, 0.3, 'sine'), 260)
}