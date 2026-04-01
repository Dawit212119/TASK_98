import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors
} from '@nestjs/common';
import { ApiBearerAuth, ApiForbiddenResponse, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Idempotent } from '../../common/decorators/idempotent.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AuthenticatedUser } from '../../common/types/request-with-context';
import { ListAttachmentsQueryDto } from './dto/list-attachments-query.dto';
import { CreateIdentityDocumentDto } from './dto/create-identity-document.dto';
import { FileService } from './file.service';

@Controller()
@UseGuards(JwtAuthGuard)
@ApiTags('Files')
@ApiBearerAuth('bearer')
@ApiUnauthorizedResponse({ description: 'Missing or invalid JWT token' })
@ApiForbiddenResponse({ description: 'Insufficient role or out-of-scope file resource' })
export class FileController {
  constructor(private readonly fileService: FileService) {}

  @Post('reservations/:reservation_id/attachments')
  @Idempotent()
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: {
        // Headroom above 10 MB for multipart overhead; FileService still rejects files > 10 MB.
        fileSize: 20 * 1024 * 1024
      }
    })
  )
  @HttpCode(HttpStatus.CREATED)
  uploadAttachment(
    @CurrentUser() user: AuthenticatedUser,
    @Param('reservation_id') reservationId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body('label') label?: string
  ): Promise<Record<string, unknown>> {
    return this.fileService.uploadReservationAttachment(user.userId, reservationId, file, label);
  }

  @Get('reservations/:reservation_id/attachments')
  listAttachments(
    @CurrentUser() user: AuthenticatedUser,
    @Param('reservation_id') reservationId: string,
    @Query() query: ListAttachmentsQueryDto
  ): Promise<Record<string, unknown>> {
    return this.fileService.listReservationAttachments(user.userId, reservationId, query);
  }

  @Get('files/:file_id/download')
  async downloadFile(
    @CurrentUser() user: AuthenticatedUser,
    @Param('file_id') fileId: string,
    @Res() response: Response
  ): Promise<void> {
    const prepared = await this.fileService.prepareDownload(user.userId, fileId);
    const safeName = prepared.filename.replace(/[^\w.\-]/g, '_');
    response.setHeader('Content-Type', prepared.mimeType);
    response.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
    prepared.stream.pipe(response);
  }

  @Post('identity-documents')
  @Idempotent()
  @HttpCode(HttpStatus.CREATED)
  createIdentityDocument(
    @CurrentUser() user: AuthenticatedUser,
    @Body() payload: CreateIdentityDocumentDto
  ): Promise<Record<string, unknown>> {
    return this.fileService.createIdentityDocument(user.userId, payload);
  }

  @Get('identity-documents/:document_id')
  @HttpCode(HttpStatus.OK)
  getIdentityDocument(
    @CurrentUser() user: AuthenticatedUser,
    @Param('document_id') documentId: string
  ): Promise<Record<string, unknown>> {
    return this.fileService.getIdentityDocument(user.userId, documentId);
  }
}
