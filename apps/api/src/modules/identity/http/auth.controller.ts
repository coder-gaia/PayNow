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

/** O user agent e guardado junto da sessao para ajudar a reconhecer o dispositivo. */
const userAgentOf = (request: Request): string | undefined => request.header('user-agent');

@ApiTags('autenticacao')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  @Public()
  @ApiOperation({
    summary: 'Cria conta e primeira organizacao',
    description:
      'Conta e organizacao nascem na mesma transacao. Um usuario sem organizacao nao ' +
      'consegue fazer nada no sistema, entao nao existe estado intermediario.',
  })
  @ApiCreatedResponse({ type: SessionResponse })
  register(@Body() dto: RegisterDto, @Req() request: Request): Promise<SessionResponse> {
    return this.auth.register(dto, userAgentOf(request));
  }

  @Post('login')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Autentica e abre uma sessao',
    description:
      'A resposta de erro nao distingue email inexistente de senha errada, e o tempo de ' +
      'resposta dos dois casos e equivalente por construcao.',
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
      'Cada refresh consome o token apresentado e emite outro. Apresentar um token ja ' +
      'consumido e tratado como vazamento e derruba a sessao inteira.',
  })
  @ApiOkResponse({ type: SessionResponse })
  refresh(@Body() dto: RefreshDto, @Req() request: Request): Promise<SessionResponse> {
    return this.auth.refresh(dto.refreshToken, userAgentOf(request));
  }

  @Post('logout')
  @Public()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Encerra a sessao',
    description: 'Revoga a familia inteira do refresh token apresentado.',
  })
  async logout(@Body() dto: RefreshDto): Promise<void> {
    await this.auth.logout(dto.refreshToken);
  }

  @Get('me')
  @ApiBearerAuth('usuario')
  @ApiOperation({ summary: 'Perfil do usuario autenticado e suas organizacoes' })
  me(@CurrentUser() user: AuthContext & { kind: 'user' }) {
    return this.auth.profile(user.userId);
  }
}
