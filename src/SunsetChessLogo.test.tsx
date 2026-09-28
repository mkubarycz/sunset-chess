import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SunsetChessLogo } from './SunsetChessLogo'

describe('SunsetChessLogo', () => {
  it('provides accessible original sunset and chess-piece artwork', () => {
    const { container } = render(<SunsetChessLogo />)
    expect(screen.getByRole('img', { name: 'Sunset Chess' })).toBeInTheDocument()
    expect(container.querySelector('.logo-sun')).toBeInTheDocument()
    expect(container.querySelector('.logo-horizon')).toBeInTheDocument()
    expect(container.querySelector('.logo-queen')).toBeInTheDocument()
    expect(container.querySelector('.logo-bishop')).toBeInTheDocument()
    expect(container.querySelectorAll('.logo-pawn')).toHaveLength(5)
  })
})
