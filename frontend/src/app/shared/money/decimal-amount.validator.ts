import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';

/**
 * Validates that a form control's value parses as a decimal amount string
 * (the format every monetary field on this app uses - see money.ts). An
 * empty value is left to `Validators.required` to catch; this validator
 * only judges the *shape* of whatever is actually typed.
 */
export function decimalAmountValidator(): ValidatorFn {
  const pattern = /^-?\d+(\.\d{1,4})?$/;
  return (control: AbstractControl): ValidationErrors | null => {
    const value = control.value;
    if (value === null || value === undefined || value === '') return null;
    return pattern.test(String(value)) ? null : { decimalAmount: true };
  };
}
