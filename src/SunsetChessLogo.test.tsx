import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SunsetChessLogo } from './SunsetChessLogo'

const accessibleName = 'Sunset Chess — queen, bishop, and pawns at sunset.'

describe('SunsetChessLogo', () => {
  it('names the brand scene and renders the licensed professional chess primitives', () => {
    const { container } = render(<SunsetChessLogo />)

    expect(screen.getByRole('img', { name: accessibleName })).toBeInTheDocument()
    expect(container.querySelector('[data-fa-icon="chess-queen"] > path')).toHaveAttribute('d')
    expect(container.querySelector('[data-fa-icon="chess-bishop"] > path')).toHaveAttribute('d')
    expect(container.querySelectorAll('[data-fa-icon="chess-pawn"]')).toHaveLength(4)
    expect(container.querySelectorAll('[data-fa-icon] path')).toHaveLength(6)
    expect(container.querySelectorAll('.logo-pawn')).toHaveLength(4)
    expect(container.querySelector('.logo-queen-crown-dot')).toHaveAttribute('r', '9.5')
  })

  it('supports decorative and compact uses', () => {
    const { container } = render(<SunsetChessLogo compact decorative />)
    const logo = container.querySelector('svg')

    expect(logo).toHaveClass('sunset-chess-logo-compact')
    expect(logo).toHaveAttribute('aria-hidden', 'true')
    expect(logo).not.toHaveAttribute('role')
    expect(logo).not.toHaveAttribute('aria-labelledby')
    expect(container.querySelector('title')).not.toBeInTheDocument()
  })

  it('uses unique local references for multiple instances', () => {
    const { container } = render(
      <>
        <SunsetChessLogo />
        <SunsetChessLogo />
      </>,
    )
    const logos = [...container.querySelectorAll('svg')]
    const titleIds = logos.map((logo) => logo.querySelector('title')?.id)
    const clipIds = logos.map((logo) => logo.querySelector('clipPath')?.id)

    expect(new Set(titleIds).size).toBe(2)
    expect(new Set(clipIds).size).toBe(2)
    logos.forEach((logo, index) => {
      expect(logo).toHaveAttribute('aria-labelledby', titleIds[index])
      expect(logo.querySelector('[clip-path]')?.getAttribute('clip-path')).toBe(`url(#${clipIds[index]})`)
    })
  })

  it('renders paths directly without external images or network references', () => {
    const { container } = render(<SunsetChessLogo />)

    expect(container.querySelectorAll('path').length).toBeGreaterThan(6)
    expect(container.querySelector('image, use, script')).not.toBeInTheDocument()
    expect(container.querySelector('[href], [src]')).not.toBeInTheDocument()
  })
})
