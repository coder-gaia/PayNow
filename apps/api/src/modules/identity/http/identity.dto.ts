import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ApiKeyEnvironment, OrganizationRole } from '@prisma/client';
import { IsEmail, IsEnum, IsString, Length, MaxLength, MinLength } from 'class-validator';

/**
 * Politica de senha: comprimento minimo e nada de regra de composicao.
 *
 * Exigir maiuscula, numero e simbolo empurra as pessoas para variacoes
 * previsiveis de senhas curtas. O NIST recomenda desde 2017 privilegiar
 * comprimento e abandonar as regras de composicao, e e o que fazemos.
 */
const PASSWORD_MIN_LENGTH = 10;
const PASSWORD_MAX_LENGTH = 200;

export class RegisterDto {
  @ApiProperty({ example: 'ana@exemplo.com' })
  @IsEmail({}, { message: 'Informe um email valido.' })
  email!: string;

  @ApiProperty({
    example: 'uma senha longa e facil de lembrar',
    minLength: PASSWORD_MIN_LENGTH,
    description: 'Comprimento minimo de 10 caracteres. Nao ha regra de composicao.',
  })
  @IsString()
  @Length(PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH, {
    message: `A senha precisa ter entre ${PASSWORD_MIN_LENGTH} e ${PASSWORD_MAX_LENGTH} caracteres.`,
  })
  password!: string;

  @ApiProperty({ example: 'Ana Ribeiro' })
  @IsString()
  @Length(2, 120)
  name!: string;

  @ApiProperty({ example: 'Livraria Aurora', description: 'Nome da primeira organizacao.' })
  @IsString()
  @Length(2, 120)
  organizationName!: string;
}

export class LoginDto {
  @ApiProperty({ example: 'ana@exemplo.com' })
  @IsEmail({}, { message: 'Informe um email valido.' })
  email!: string;

  @ApiProperty({ example: 'uma senha longa e facil de lembrar' })
  @IsString()
  @MaxLength(PASSWORD_MAX_LENGTH)
  password!: string;
}

export class RefreshDto {
  @ApiProperty({ description: 'Refresh token recebido no login ou na rotacao anterior.' })
  @IsString()
  @MinLength(20)
  refreshToken!: string;
}

export class CreateOrganizationDto {
  @ApiProperty({ example: 'Cafe do Bairro' })
  @IsString()
  @Length(2, 120)
  name!: string;
}

export class AddMemberDto {
  @ApiProperty({ example: 'bruno@exemplo.com', description: 'A pessoa precisa ja ter conta.' })
  @IsEmail({}, { message: 'Informe um email valido.' })
  email!: string;

  @ApiProperty({ enum: OrganizationRole, example: OrganizationRole.MEMBER })
  @IsEnum(OrganizationRole)
  role!: OrganizationRole;
}

export class UpdateMemberRoleDto {
  @ApiProperty({ enum: OrganizationRole, example: OrganizationRole.ADMIN })
  @IsEnum(OrganizationRole)
  role!: OrganizationRole;
}

export class CreateApiKeyDto {
  @ApiProperty({ example: 'Servidor de producao' })
  @IsString()
  @Length(2, 80)
  name!: string;

  @ApiPropertyOptional({
    enum: ApiKeyEnvironment,
    default: ApiKeyEnvironment.TEST,
    description: 'Chaves TEST nao movimentam dinheiro real.',
  })
  @IsEnum(ApiKeyEnvironment)
  environment: ApiKeyEnvironment = ApiKeyEnvironment.TEST;
}

// ---------------------------------------------------------------------------
// Respostas, declaradas para que o contrato OpenAPI seja util de verdade
// ---------------------------------------------------------------------------

export class SessionResponse {
  @ApiProperty() accessToken!: string;
  @ApiProperty() refreshToken!: string;
  @ApiProperty({ example: 900, description: 'Validade do token de acesso, em segundos.' })
  expiresInSeconds!: number;
  @ApiProperty({ type: 'object', additionalProperties: true })
  user!: { id: string; email: string; name: string };
}

export class OrganizationSummary {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() slug!: string;
  @ApiProperty({ enum: OrganizationRole }) role!: OrganizationRole;
  @ApiProperty() createdAt!: Date;
}

export class MemberResponse {
  @ApiProperty() userId!: string;
  @ApiProperty() name!: string;
  @ApiProperty() email!: string;
  @ApiProperty({ enum: OrganizationRole }) role!: OrganizationRole;
  @ApiProperty() joinedAt!: Date;
}

export class ApiKeyResponse {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ enum: ApiKeyEnvironment }) environment!: ApiKeyEnvironment;
  @ApiProperty({ example: 'sk_test_a1b2c3d4', description: 'Parte visivel da chave.' })
  prefix!: string;
  @ApiPropertyOptional() lastUsedAt?: Date | null;
  @ApiPropertyOptional() revokedAt?: Date | null;
  @ApiProperty() createdAt!: Date;
}

export class CreatedApiKeyResponse extends ApiKeyResponse {
  @ApiProperty({
    description: 'Chave completa. Mostrada uma unica vez: nao ha como recupera-la depois.',
    example: 'sk_test_a1b2c3d4e5f6...',
  })
  secret!: string;
}
