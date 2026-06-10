import {
  Body, Controller, Delete, Get, Param, Patch, Post,
  Query, UseGuards, UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Role } from '../../common/enums/role.enum';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import {
  CreateUserSchema, UpdateUserSchema, PagePaginationSchema,
  UpdateProfileSchema, UpdateAdminProfileSchema,
  type JwtPayload, type CreateUserInput, type UpdateUserInput,
  type UpdateProfileInput, type UpdateAdminProfileInput,
} from '@karamooziyar/shared';
import { FILE_LIMITS } from '@karamooziyar/shared';

@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  // ─── Own profile ───────────────────────────────────────────

  @Get('me')
  getMe(@CurrentUser() user: JwtPayload) {
    return this.usersService.findById(user.sub);
  }

  @Patch('me')
  updateMe(
    @Body(new ZodValidationPipe(UpdateProfileSchema)) body: UpdateProfileInput,
    @CurrentUser() user: JwtPayload,
  ) {
    // Admins can use this too (updateProfile is safe)
    if (user.role === Role.ADMIN) {
      return this.usersService.updateAdminProfile(user.sub, body as UpdateAdminProfileInput);
    }
    return this.usersService.updateProfile(user.sub, body);
  }

  @Post('me/profile-image')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } }))
  uploadMyProfileImage(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.usersService.uploadProfileImage(user.sub, file, user.sub, user.role);
  }

  // ─── Admin: list / create / manage trainees ────────────────

  @Get()
  @Roles(Role.ADMIN)
  findAll(
    @Query(new ZodValidationPipe(PagePaginationSchema))
    query: { page: number; limit: number; search?: string },
  ) {
    return this.usersService.findAll(query.page, query.limit, query.search);
  }

  @Get('without-conversation')
  @Roles(Role.ADMIN)
  findWithoutConversation(
    @Query(new ZodValidationPipe(PagePaginationSchema))
    query: { page: number; limit: number; search?: string },
  ) {
    return this.usersService.findWithoutConversation(query.page, query.limit, query.search);
  }

  @Post()
  @Roles(Role.ADMIN)
  create(@Body(new ZodValidationPipe(CreateUserSchema)) body: CreateUserInput) {
    return this.usersService.create(body);
  }

  @Get(':id')
  @Roles(Role.ADMIN)
  findOne(@Param('id') id: string) {
    return this.usersService.findById(id);
  }

  @Patch(':id')
  @Roles(Role.ADMIN)
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateUserSchema)) body: UpdateUserInput,
    @CurrentUser() currentUser: JwtPayload,
  ) {
    return this.usersService.update(id, body, currentUser.sub);
  }

  @Post(':id/profile-image')
  @Roles(Role.ADMIN)
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } }))
  uploadProfileImage(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.usersService.uploadProfileImage(id, file, user.sub, user.role);
  }

  @Patch(':id/status')
  @Roles(Role.ADMIN)
  setStatus(
    @Param('id') id: string,
    @Body() body: { isActive: boolean },
    @CurrentUser() user: JwtPayload,
  ) {
    return this.usersService.setActiveStatus(id, body.isActive, user.sub);
  }

  @Delete(':id')
  @Roles(Role.ADMIN)
  remove(@Param('id') id: string) {
    return this.usersService.softDelete(id);
  }
}
