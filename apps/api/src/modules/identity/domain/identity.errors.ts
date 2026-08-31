import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';

/**
 * Erros do módulo de identidade.
 *
 * Duas regras guiam as mensagens:
 *
 * 1. Erro de autenticação nunca diz se o problema foi o email ou a senha. A
 *    distinção transforma o formulário de login em um verificador de quais
 *    emails existem no sistema.
 * 2. Erro de autorização diz o que faltou, porque quem já está autenticado tem
 *    direito de entender por que foi barrado.
 */

export class InvalidCredentialsError extends UnauthorizedException {
  constructor() {
    super('Email ou senha inválidos.');
  }
}

export class EmailAlreadyRegisteredError extends ConflictException {
  constructor() {
    super('Já existe uma conta com este email.');
  }
}

export class InvalidRefreshTokenError extends UnauthorizedException {
  constructor(detail = 'Refresh token inválido ou expirado.') {
    super(detail);
  }
}

/**
 * Reuso de refresh token já consumido. Trata-se de vazamento até prova em
 * contrario, então a familia inteira é revogada antes deste erro subir.
 */
export class RefreshTokenReuseError extends UnauthorizedException {
  constructor() {
    super('Sessão encerrada por segurança: este refresh token já tinha sido usado.');
  }
}

export class OrganizationNotFoundError extends NotFoundException {
  constructor() {
    super('Organização não encontrada.');
  }
}

export class NotAMemberError extends ForbiddenException {
  constructor() {
    super('Você não pertence a esta organização.');
  }
}

export class InsufficientRoleError extends ForbiddenException {
  constructor(required: string, actual: string) {
    super(`Esta ação exige o papel ${required} ou superior. O seu papel é ${actual}.`);
  }
}

export class CannotDemoteLastOwnerError extends BadRequestException {
  constructor() {
    super('A organização precisa de ao menos um OWNER. Promova outra pessoa antes.');
  }
}

export class MemberAlreadyExistsError extends ConflictException {
  constructor() {
    super('Esta pessoa já pertence à organização.');
  }
}

export class MemberNotFoundError extends NotFoundException {
  constructor() {
    super('Membro não encontrado nesta organização.');
  }
}

export class UserNotFoundError extends NotFoundException {
  constructor() {
    super('Usuário não encontrado.');
  }
}

export class ApiKeyNotFoundError extends NotFoundException {
  constructor() {
    super('Chave de API não encontrada.');
  }
}
