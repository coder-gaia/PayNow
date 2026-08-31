import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';

import { AuthService } from '../application/auth.service';
import { CurrentUser, Public } from '../../platform/http/auth-context';
import type { AuthContext } from '../../platform/http/auth-context';
import { LoginDto, RefreshDto, RegisterDto, SessionResponse } from './identity.dto';

/** O user agent é guardado junto da sessão para ajudar a reconhecer o dispositivo. */
const userAgentOf = (request: Request): string | undefined => request.header('user-agent');

@ApiTags('autenticação')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  @Public()
  @ApiOperation({
    summary: 'Cria conta e primeira organizacao',
    description:
      'Conta e organização nascem na mesma transação. Um usuário sem organização não ' +
      'consegue fazer nada no sistema, então não existe estado intermediário.',
  })
  @ApiCreatedResponse({ type: SessionResponse })
  register(@Body() dto: RegisterDto, @Req() request: Request): Promise<SessionResponse> {
    return this.auth.register(dto, userAgentOf(request));
  }

  @Post('login')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Autentica e abre uma sessão',
    description:
      'A resposta de erro não distingue email inexistente de senha errada, e o tempo de ' +
      'resposta dos dois casos e equivalente por construção.',
  })
  @ApiOkResponse({ type: SessionResponse })
  login(@Body() dto: LoginDto, @Req() request: Request): Promise<SessionResponse> {
    return this.auth.login(dto.email, dto.password, userAgentOf(request));
  }

  @Post('refresh')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Rotaciona o refresh token',
    description:
      'Cada refresh consome o token apresentado e emite outro. Apresentar um token já ' +
      'consumido é tratado como vazamento e derruba a sessão inteira.',
  })
  @ApiOkResponse({ type: SessionResponse })
  refresh(@Body() dto: RefreshDto, @Req() request: Request): Promise<SessionResponse> {
    return this.auth.refresh(dto.refreshToken, userAgentOf(request));
  }

  @Post('logout')
  @Public()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Encerra a sessão',
    description: 'Revoga a familia inteira do refresh token apresentado.',
  })
  async logout(@Body() dto: RefreshDto): Promise<void> {
    await this.auth.logout(dto.refreshToken);
  }

  @Get('me')
  @ApiBearerAuth('usuário')
  @ApiOperation({ summary: 'Perfil do usuário autenticado e suas organizações' })
  me(@CurrentUser() user: AuthContext & { kind: 'user' }) {
    return this.auth.profile(user.userId);
  }
}
