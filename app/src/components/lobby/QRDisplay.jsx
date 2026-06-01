/**
 * QRDisplay — shows a QR code for the session join link plus a copy button.
 *
 * Props:
 *   joinUrl   string   — full join URL (e.g. https://app.rockdrop.io/join?token=...)
 */

import { useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import Button from '../ui/Button.jsx'

export default function QRDisplay({ joinUrl }) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(joinUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    } catch {
      // Fallback: select text in a temporary input
      const el = document.createElement('input')
      el.value = joinUrl
      document.body.appendChild(el)
      el.select()
      document.execCommand('copy')
      document.body.removeChild(el)
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    }
  }

  return (
    <div className="flex flex-col items-center gap-5">
      {/* QR code in a white padded box */}
      <div
        className="p-4 bg-white border border-zinc-200 rounded-2xl shadow-sm"
        aria-label="Código QR para unirse a la sesión"
      >
        <QRCodeSVG
          value={joinUrl}
          size={200}
          bgColor="#ffffff"
          fgColor="#18181b"
          level="M"
          includeMargin={false}
        />
      </div>

      {/* Link text */}
      <p
        className="text-xs text-zinc-400 text-center px-2 break-all max-w-xs"
        aria-label="URL para unirse"
      >
        {joinUrl}
      </p>

      {/* Copy button */}
      <Button
        variant="ghost"
        size="sm"
        onClick={handleCopy}
        aria-label={copied ? 'Enlace copiado' : 'Copiar enlace de invitación'}
        className="min-w-36"
      >
        {copied ? (
          <>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="w-4 h-4 text-green-600"
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden="true"
            >
              <path
                fillRule="evenodd"
                d="M16.707 5.293a1 1 0 010 1.414L8.414 15l-4.121-4.121a1 1 0 011.414-1.414L8.414 12.172l7.293-7.293a1 1 0 011.414 0z"
                clipRule="evenodd"
              />
            </svg>
            <span className="text-green-700">¡Copiado!</span>
          </>
        ) : (
          <>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
              />
            </svg>
            Copiar enlace
          </>
        )}
      </Button>
    </div>
  )
}
