import assert from 'node:assert/strict'
import { clampWindowBounds } from '../src/main/windowBounds'

const primary = { x: 0, y: 0, width: 1920, height: 1040 }
const removedDisplay = clampWindowBounds({ x: 2800, y: 100, width: 1440, height: 900, maximized: true }, primary)
assert.deepEqual(removedDisplay, { x: 480, y: 100, width: 1440, height: 900, maximized: true })

const leftDisplay = { x: -1600, y: -200, width: 1600, height: 900 }
assert.deepEqual(clampWindowBounds({ x: -1500, y: -100, width: 1000, height: 700, maximized: false }, leftDisplay),
  { x: -1500, y: -100, width: 1000, height: 700, maximized: false })

const small = clampWindowBounds({ x: 0, y: 0, width: 3000, height: 1800, maximized: false }, { x: 20, y: 10, width: 800, height: 500 })
assert.deepEqual(small, { x: 20, y: 10, width: 800, height: 500, maximized: false })
assert.deepEqual(clampWindowBounds({ width: 1000, height: 700, maximized: false }, primary),
  { x: 460, y: 170, width: 1000, height: 700, maximized: false })
console.log('window bounds: removed display, negative coordinates, small screen, first launch passed')
