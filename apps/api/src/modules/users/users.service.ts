import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';

/** Normalize Iranian mobile number to 09xxxxxxxxx format */
function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.startsWith('98') && digits.length === 12) return '0' + digits.slice(2);
  return digits;
}

/** Validate canonical Iranian phone: 09xxxxxxxxx (11 digits) */
function isValidIranianPhone(phone: string): boolean {
  return /^09\d{9}$/.test(phone);
}
import type { User } from '@prisma/client';
import type {
  UserDto,
  UserProfileDto,
  PaginatedResponse,
  CreateUserInput,
  UpdateUserInput,
  UpdateProfileInput,
  UpdateAdminProfileInput,
} from '@karamooziyar/shared';
import { Role, Gender } from '@karamooziyar/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { UploadsService } from '../uploads/uploads.service';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly uploadsService: UploadsService,
  ) {}

  async findAll(
    page: number,
    limit: number,
    search?: string,
  ): Promise<PaginatedResponse<UserDto>> {
    const where = {
      deletedAt: null,
      role: 'USER' as const,
      ...(search ? {
        OR: [
          { firstName: { contains: search, mode: 'insensitive' as const } },
          { lastName: { contains: search, mode: 'insensitive' as const } },
          { nationalId: { contains: search } },
          { phoneNumber: { contains: search } },
          { expertiseField: { contains: search, mode: 'insensitive' as const } },
        ],
      } : {}),
    };

    const [users, total, activeCount] = await Promise.all([
      this.prisma.user.findMany({
        where, skip: (page - 1) * limit, take: limit, orderBy: { createdAt: 'desc' },
      }),
      this.prisma.user.count({ where }),
      this.prisma.user.count({ where: { ...where, isActive: true } }),
    ]);

    return {
      data: users.map(u => this.mapToDto(u)),
      meta: { total, page, limit, activeCount, inactiveCount: total - activeCount },
    };
  }

  async findWithoutConversation(page: number, limit: number, search?: string): Promise<PaginatedResponse<UserDto>> {
    const where = {
      deletedAt: null, role: 'USER' as const,
      conversation: { lastMessageAt: null },
      ...(search ? { OR: [
        { firstName: { contains: search, mode: 'insensitive' as const } },
        { lastName: { contains: search, mode: 'insensitive' as const } },
      ] } : {}),
    };
    const [users, total] = await Promise.all([
      this.prisma.user.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }] }),
      this.prisma.user.count({ where }),
    ]);
    return { data: users.map(u => this.mapToDto(u)), meta: { total, page, limit } };
  }

  async findById(id: string): Promise<UserProfileDto> {
    const user = await this.prisma.user.findUnique({ where: { id, deletedAt: null } });
    if (!user) throw new NotFoundException('کاربر یافت نشد');
    return this.mapToProfileDto(user);
  }

  async findByNationalId(nationalId: string): Promise<UserProfileDto> {
    const user = await this.prisma.user.findUnique({ where: { nationalId, deletedAt: null } });
    if (!user) throw new NotFoundException('کاربر یافت نشد');
    return this.mapToProfileDto(user);
  }

  async create(input: CreateUserInput): Promise<UserDto> {
    const existing = await this.prisma.user.findFirst({
      where: { OR: [{ nationalId: input.nationalId }, { phoneNumber: input.phoneNumber }], deletedAt: null },
    });
    if (existing) {
      if (existing.nationalId === input.nationalId)
        throw new ConflictException('کاربری با این شماره ملی قبلاً ثبت شده است');
      throw new ConflictException('کاربری با این شماره تماس قبلاً ثبت شده است');
    }

    const data: any = {
      firstName: input.firstName,
      lastName: input.lastName,
      nationalId: input.nationalId,
      phoneNumber: input.phoneNumber,
      judicialDomain: input.judicialDomain,
      expertiseField: input.expertiseField,
      role: 'USER',
      fatherName: input.fatherName ?? null,
      birthCertificateNumber: input.birthCertificateNumber ?? null,
      birthDate: input.birthDate ? new Date(input.birthDate) : null,
      gender: input.gender ?? null,
      residenceProvince: input.residenceProvince ?? null,
      residenceCity: input.residenceCity ?? null,
    };

    const user = await this.prisma.user.create({ data });
    await this.prisma.conversation.create({ data: { userId: user.id } });
    return this.mapToDto(user);
  }

  async update(id: string, input: UpdateUserInput, adminId?: string): Promise<UserDto> {
    await this.findById(id);

    if (input.phoneNumber) {
      const normalized = normalizePhone(input.phoneNumber);
      if (!isValidIranianPhone(normalized)) throw new BadRequestException('شماره موبایل نامعتبر است');
      input = { ...input, phoneNumber: normalized };
      const conflict = await this.prisma.user.findFirst({
        where: { phoneNumber: normalized, id: { not: id }, deletedAt: null },
      });
      if (conflict) throw new ConflictException('این شماره موبایل قبلاً استفاده شده است');
    }

    const data: any = { ...input };
    if (input.birthDate) data.birthDate = new Date(input.birthDate as string);
    else if (input.birthDate === null) data.birthDate = null;

    const user = await this.prisma.user.update({ where: { id }, data });

    // Audit log
    if (adminId) {
      await this.prisma.auditLog.create({
        data: { userId: adminId, action: 'UPDATE_USER', resource: 'User', resourceId: id, metadata: input as any },
      }).catch(() => {});
    }

    return this.mapToDto(user);
  }

  async updateProfile(userId: string, input: UpdateProfileInput): Promise<UserProfileDto> {
    const user = await this.prisma.user.findUnique({ where: { id: userId, deletedAt: null } });
    if (!user) throw new NotFoundException('کاربر یافت نشد');

    const data: any = {};
    if (input.firstName !== undefined) data.firstName = input.firstName;
    if (input.lastName !== undefined) data.lastName = input.lastName;
    if (input.phoneNumber !== undefined) {
      const normalized = normalizePhone(input.phoneNumber);
      if (!isValidIranianPhone(normalized)) throw new BadRequestException('شماره موبایل نامعتبر است');
      if (normalized !== user.phoneNumber) {
        const conflict = await this.prisma.user.findFirst({
          where: { phoneNumber: normalized, id: { not: userId }, deletedAt: null },
        });
        if (conflict) throw new ConflictException('این شماره موبایل قبلاً استفاده شده است');
      }
      data.phoneNumber = normalized;
    }
    if (input.judicialDomain !== undefined) data.judicialDomain = input.judicialDomain;
    if (input.expertiseField !== undefined) data.expertiseField = input.expertiseField;
    if (input.fatherName !== undefined) data.fatherName = input.fatherName;
    if (input.birthCertificateNumber !== undefined) data.birthCertificateNumber = input.birthCertificateNumber;
    if (input.birthDate !== undefined) data.birthDate = input.birthDate ? new Date(input.birthDate) : null;
    if (input.gender !== undefined) data.gender = input.gender;
    if (input.residenceProvince !== undefined) data.residenceProvince = input.residenceProvince;
    if (input.residenceCity !== undefined) data.residenceCity = input.residenceCity;

    const updated = await this.prisma.user.update({ where: { id: userId }, data });
    return this.mapToProfileDto(updated);
  }

  async updateAdminProfile(adminId: string, input: UpdateAdminProfileInput): Promise<UserProfileDto> {
    const admin = await this.prisma.user.findUnique({ where: { id: adminId, deletedAt: null } });
    if (!admin) throw new NotFoundException('کاربر یافت نشد');
    if (admin.role !== 'ADMIN') throw new ForbiddenException('دسترسی غیرمجاز');

    const data: any = {};
    if (input.firstName !== undefined) data.firstName = input.firstName;
    if (input.lastName !== undefined) data.lastName = input.lastName;
    if (input.phoneNumber !== undefined) {
      const normalized = normalizePhone(input.phoneNumber);
      if (!isValidIranianPhone(normalized)) throw new BadRequestException('شماره موبایل نامعتبر است');
      if (normalized !== admin.phoneNumber) {
        const conflict = await this.prisma.user.findFirst({
          where: { phoneNumber: normalized, id: { not: adminId }, deletedAt: null },
        });
        if (conflict) throw new ConflictException('این شماره موبایل قبلاً استفاده شده است');
      }
      data.phoneNumber = normalized;
    }

    const updated = await this.prisma.user.update({ where: { id: adminId }, data });
    return this.mapToProfileDto(updated);
  }

  async uploadProfileImage(userId: string, file: Express.Multer.File, requesterId: string, requesterRole: string): Promise<{ profileImageUrl: string; avatarUrl: string; fileKey: string }> {
    // Users can only update their own image; admins can update anyone
    if (requesterRole !== 'ADMIN' && userId !== requesterId) {
      throw new ForbiddenException('دسترسی غیرمجاز');
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId, deletedAt: null } });
    if (!user) throw new NotFoundException('کاربر یافت نشد');

    // Upload to S3 with profile folder
    const result = await this.uploadsService.uploadProfileImage(file, userId);

    // Always store the public URL in avatarUrl so /me returns it immediately
    await this.prisma.user.update({
      where: { id: userId },
      data: { avatarUrl: result.fileUrl },
    });

    // Also attempt to link the attachment record for richer metadata
    try {
      const record = await (this.prisma.newsletterAttachment as any).create({
        data: {
          fileName: result.fileName,
          fileKey: result.fileKey,
          fileUrl: result.fileUrl,
          mimeType: result.mimeType,
          fileSize: result.fileSize,
          duration: null,
        },
      });
      await (this.prisma.user as any).update({
        where: { id: userId },
        data: { profileImageAttachmentId: record.id },
      });
    } catch {
      // attachment table not available — avatarUrl already saved above
    }

    // Return both:
    //   fileKey     — the S3 object key (stored in Zustand for on-demand signing)
    //   profileImageUrl — fresh presigned URL for immediate display in this response only
    const signedUrl = await this.uploadsService.getPresignedUrl(result.fileKey, 3600);
    return {
      profileImageUrl: signedUrl,
      fileKey: result.fileKey,
      avatarUrl: result.fileUrl,   // raw MinIO URL — store this in Zustand, not the presigned one
    };
  }

  async setActiveStatus(id: string, isActive: boolean, adminId: string): Promise<UserDto> {
    const user = await this.prisma.user.findUnique({ where: { id, deletedAt: null } });
    if (!user) throw new NotFoundException('کاربر یافت نشد');

    const updated = await this.prisma.user.update({ where: { id }, data: { isActive } });

    await this.prisma.auditLog.create({
      data: {
        userId: adminId,
        action: isActive ? 'ACTIVATE_USER' : 'DEACTIVATE_USER',
        resource: 'User', resourceId: id,
      },
    }).catch(() => {});

    return this.mapToDto(updated);
  }

  async softDelete(id: string): Promise<{ message: string }> {
    await this.findById(id);
    await this.prisma.user.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
    return { message: 'کاربر غیرفعال شد' };
  }

  private mapToDto(user: User): UserDto {
    return {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      nationalId: user.nationalId,
      phoneNumber: user.phoneNumber,
      judicialDomain: user.judicialDomain,
      expertiseField: user.expertiseField,
      role: user.role as Role,
      isActive: user.isActive,
      avatarUrl: user.avatarUrl,
      profileImageUrl: null, // populated lazily via signed URL if needed
      createdAt: user.createdAt.toISOString(),
    };
  }

  private mapToProfileDto(user: User): UserProfileDto {
    return {
      ...this.mapToDto(user),
      fatherName: (user as any).fatherName ?? null,
      birthCertificateNumber: (user as any).birthCertificateNumber ?? null,
      birthDate: (user as any).birthDate ? new Date((user as any).birthDate).toISOString() : null,
      gender: ((user as any).gender as Gender) ?? null,
      residenceProvince: (user as any).residenceProvince ?? null,
      residenceCity: (user as any).residenceCity ?? null,
      profileImageAttachmentId: (user as any).profileImageAttachmentId ?? null,
      updatedAt: user.updatedAt.toISOString(),
    };
  }
}
