import { Global, Module } from '@nestjs/common';

import { CLOCK, SystemClock } from './clock';

/**
 * Ver ADR-0009. O relogio e global porque praticamente todo modulo precisa de
 * tempo, e obriga-los a importar um modulo so para isso criaria acoplamento
 * sem beneficio.
 */
@Global()
@Module({
  providers: [{ provide: CLOCK, useClass: SystemClock }],
  exports: [CLOCK],
})
export class ClockModule {}
