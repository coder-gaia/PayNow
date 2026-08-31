import { Global, Module } from '@nestjs/common';

import { CLOCK, SystemClock } from './clock';

/**
 * Ver ADR-0009. O relógio e global porque praticamente todo módulo precisa de
 * tempo, e obriga-los a importar um módulo só para isso criaria acoplamento
 * sem beneficio.
 */
@Global()
@Module({
  providers: [{ provide: CLOCK, useClass: SystemClock }],
  exports: [CLOCK],
})
export class ClockModule {}
