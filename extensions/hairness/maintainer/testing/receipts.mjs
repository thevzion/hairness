export async function receipt(runtime, value) {
  return runtime.contracts.validateSchema('./testing/schemas/test-run-receipt.schema.json', value, 'TestRunReceipt')
}
