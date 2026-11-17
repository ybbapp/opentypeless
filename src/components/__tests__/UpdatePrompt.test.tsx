import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { UpdatePrompt } from '../UpdatePrompt'

const { mockCheck } = vi.hoisted(() => ({
  mockCheck: vi.fn(),
}))

vi.mock('@tauri-apps/plugin-updater', () => ({
  check: mockCheck,
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('UpdatePrompt', () => {
  it('does not consult the official updater feed or show an update prompt', () => {
    mockCheck.mockResolvedValue({
      version: '9.9.9',
      downloadAndInstall: vi.fn(),
    })

    render(<UpdatePrompt />)

    expect(screen.queryByText(/update available/i)).not.toBeInTheDocument()
    expect(mockCheck).not.toHaveBeenCalled()
  })
})
