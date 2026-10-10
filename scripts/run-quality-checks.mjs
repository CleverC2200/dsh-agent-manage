/** Collect every independent quality command; admission and preparation run outside this collector. */
export async function runQualityChecks(checks) {
  const results = []
  for (const { name, execute } of checks) {
    try {
      await execute()
      results.push({ name, status: 'passed' })
    } catch (error) {
      results.push({ name, status: error.name === 'AbortError' ? 'cancelled' : 'failed', error: error.message })
    }
  }
  return results
}
