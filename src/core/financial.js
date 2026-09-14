/** Backward-compatible shim for the domain-neutral financial capability port. */
export {
  registerFinancialProvider,
  clearFinancialProvider,
  getFinancialProvider,
  createFinancial
} from './ports/finance.js';

import { createFinancial } from './ports/finance.js';
export default class FinancialController {
  constructor(config = {}) { return createFinancial(config); }
}
