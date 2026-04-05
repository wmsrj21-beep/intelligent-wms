import Link from 'next/link'

export default function Home() {
  return (
    <main className="min-h-screen flex items-center justify-center"
      style={{ backgroundColor: '#0f1923' }}>
      <div className="text-center">
        <h1 className="text-4xl font-bold text-white tracking-widest uppercase">
          Intelligent WMS
        </h1>
        <p className="text-slate-400 mt-2 tracking-wider">
          Sistema de Gestão de Armazém
        </p>
        <Link href="/login"
          className="mt-8 inline-block px-8 py-3 rounded font-bold tracking-widest uppercase text-white"
          style={{ backgroundColor: '#00b4b4' }}>
          Acessar Sistema
        </Link>
      </div>
    </main>
  )
}