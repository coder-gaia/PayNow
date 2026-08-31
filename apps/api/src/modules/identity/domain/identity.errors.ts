import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';

/**
 * Erros do modulo de identidade.
 *
 * Duas regras guiam as mensagens:
 *
 * 1. Erro de autenticacao nunca diz se o problema foi o email ou a senha. A
 *    distincao transforma o formulario de login em um verificador de quais
 *    emails existem no sistema.
 * 2. Erro de autorizacao diz o que faltou, porque quem ja esta autenticado tem
 *    direito de entender por que foi barrado.
 */

export class InvalidCredentialsError extends UnauthorizedException {
  constructor() {
    super('Email ou senha invalidos.');
  }
}

export class EmailAlreadyRegisteredError extends ConflictException {
  constructor() {
    super('Ja existe uma conta com este email.');
  }
}

export class InvalidRefreshTokenError extends UnauthorizedException {
  constructor(detail = 'Refresh token invalido ou expirado.') {
    super(detail);
  }
}

/**
 * Reuso de refresh token ja consumido. Trata-se de vazamento ate prova em
 * contrario, entao a familia inteira e revogada antes deste erro subir.
 */
export class RefreshTokenReuseError extends UnauthorizedException {
  constructor() {
    super('Sessao encerrada por seguranca: este refresh token ja tinha sido usado.');
  }
}

export class OrganizationNotFoundError extends NotFoundException {
  constructor() {
    super('Organizacao nao encontrada.');
  }
}

export class NotAMemberError extends ForbiddenException {
  constructor() {
    super('Voce nao pertence a esta organizacao.');
  }
}

export class InsufficientRoleError extends ForbiddenException {
  constructor(required: string, actual: string) {
    super(`Esta acao exige o papel ${required} ou superior. O seu papel e ${actual}.`);
  }
}

export class CannotDemoteLastOwnerError extends BadRequestException {
  constructor() {
    super('A organizacao precisa de ao menos um OWNER. Promova outra pessoa antes.');
  }
}

export class MemberAlreadyExistsError extends ConflictException {
  constructor() {
    super('Esta pessoa ja pertence a organizacao.');
  }
}

export class MemberNotFoundError extends NotFoundException {
  constructor() {
    super('Membro nao encontrado nesta organizacao.');
  }
}

export class UserNotFoundError extends NotFoundException {
  constructor() {
    super('Usuario nao encontrado.');
  }
}

export class ApiKeyNotFoundError extends NotFoundException {
  constructor() {
    super('Chave de API nao encontrada.');
  }
}
