import { ApiProperty } from '@nestjs/swagger';

export class AccountBalanceResponse {
  @ApiProperty({ example: 'customer:receivable' }) code!: string;
  @ApiProperty({ example: 'Contas a receber' }) label!: string;
  @ApiProperty({ example: 'ASSET' }) kind!: string;
  @ApiProperty({ enum: ['debit', 'credit'] }) normalBalance!: 'debit' | 'credit';
  @ApiProperty({
    example: '10000',
    description: 'Saldo em unidade minima, como string. Positivo e devedor.',
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
  @ApiProperty({ example: '10000', description: 'Positivo e debito, negativo e credito.' })
  amountMinor!: string;
  @ApiProperty({ example: '100.00' }) amount!: string;
  @ApiProperty({ example: 'BRL' }) currency!: string;
}

export class JournalEntryResponse {
  @ApiProperty() id!: string;
  @ApiProperty({ example: 'payment.succeeded' }) eventType!: string;
  @ApiProperty({ description: 'Identificador do evento que originou o lancamento.' })
  eventId!: string;
  @ApiProperty() description!: string;
  @ApiProperty() occurredAt!: Date;
  @ApiProperty() createdAt!: Date;
  @ApiProperty({ example: '100.00', description: 'Soma dos debitos do lancamento.' })
  total!: string;
  @ApiProperty({ type: [JournalLineResponse] }) lines!: JournalLineResponse[];
}

export class VerificationResponse {
  @ApiProperty() checkedAt!: Date;
  @ApiProperty() entryCount!: number;
  @ApiProperty() lineCount!: number;
  @ApiProperty({ description: 'Falso se qualquer invariante contabil estiver violado.' })
  balanced!: boolean;
  @ApiProperty({ type: [String] }) violations!: string[];
}
