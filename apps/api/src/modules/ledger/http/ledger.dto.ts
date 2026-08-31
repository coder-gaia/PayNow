import { ApiProperty } from '@nestjs/swagger';

export class AccountBalanceResponse {
  @ApiProperty({ example: 'customer:receivable' }) code!: string;
  @ApiProperty({ example: 'Contas a receber' }) label!: string;
  @ApiProperty({ example: 'O que o cliente deve ao merchant por faturas já emitidas.' })
  description!: string;
  @ApiProperty({ example: 'ASSET' }) kind!: string;
  @ApiProperty({ enum: ['debit', 'credit'] }) normalBalance!: 'debit' | 'credit';
  @ApiProperty({
    example: '10000',
    description: 'Saldo em unidade mínima, como string. Positivo é devedor.',
  })
  balanceMinor!: string;
  @ApiProperty({ example: '100.00' }) balance!: string;
  @ApiProperty({ example: 'BRL' }) currency!: string;
  @ApiProperty({ example: 4, description: 'Quantas linhas compoem este saldo.' })
  lineCount!: number;
}

export class JournalLineResponse {
  @ApiProperty() id!: string;
  @ApiProperty({ example: 'gateway:clearing' }) account!: string;
  @ApiProperty({ example: 'Em liquidação no gateway' }) label!: string;
  @ApiProperty({ example: '10000', description: 'Positivo é débito, negativo é crédito.' })
  amountMinor!: string;
  @ApiProperty({ example: '100.00' }) amount!: string;
  @ApiProperty({ example: 'BRL' }) currency!: string;
}

export class JournalEntryResponse {
  @ApiProperty() id!: string;
  @ApiProperty({ example: 'payment.succeeded' }) eventType!: string;
  @ApiProperty({ description: 'Identificador do evento que originou o lançamento.' })
  eventId!: string;
  @ApiProperty() description!: string;
  @ApiProperty() occurredAt!: Date;
  @ApiProperty() createdAt!: Date;
  @ApiProperty({ example: '100.00', description: 'Soma dos débitos do lançamento.' })
  total!: string;
  @ApiProperty({ type: [JournalLineResponse] }) lines!: JournalLineResponse[];
}

export class VerificationResponse {
  @ApiProperty() checkedAt!: Date;
  @ApiProperty() entryCount!: number;
  @ApiProperty() lineCount!: number;
  @ApiProperty({ description: 'Falso se qualquer invariante contábil estiver violado.' })
  balanced!: boolean;
  @ApiProperty({ type: [String] }) violations!: string[];
}
