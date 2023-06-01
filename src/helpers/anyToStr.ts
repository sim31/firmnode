
export function anyToStr(err: any): string {
  if (typeof err.toString === 'function') {
    return err.toString();
  } else {
    return JSON.stringify(err);
  }
}