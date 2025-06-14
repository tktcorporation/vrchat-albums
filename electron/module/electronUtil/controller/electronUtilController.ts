import consola from 'consola';
import * as datefns from 'date-fns';
import { clipboard } from 'electron';
import * as path from 'pathe';
import sharp from 'sharp';
import z from 'zod';
import { getWindow } from '../../../electronUtil';
import {
  fileOperationErrorMappings,
  handleResultError,
  handleResultErrorWithSilent,
} from '../../../lib/errorHelpers';
import * as exiftool from '../../../lib/wrappedExifTool';
import { eventEmitter, procedure, router as trpcRouter } from './../../../trpc';
import { DirectoryPathSchema } from './../../../valueObjects/index';
import * as utilsService from './../service';

const reloadWindow = () => {
  const mainWindow = getWindow();
  if (mainWindow) {
    mainWindow.reload();
  }
};

export const electronUtilRouter = () =>
  trpcRouter({
    openUrlInDefaultBrowser: procedure
      .input(z.string())
      .mutation(async (ctx) => {
        consola.log('openUrlInDefaultBrowser', ctx.input);
        await utilsService.openUrlInDefaultBrowser(ctx.input);
        return true;
      }),
    reloadWindow: procedure.mutation(async () => {
      consola.log('reloadWindow');
      await reloadWindow();
    }),
    getVRChatPhotoItemData: procedure.input(z.string()).query(async (ctx) => {
      const photoBuf = await sharp(ctx.input).resize(256).toBuffer();
      return `data:image/${path
        .extname(ctx.input)
        .replace('.', '')};base64,${photoBuf.toString('base64')}`;
    }),
    copyTextToClipboard: procedure.input(z.string()).mutation(async (ctx) => {
      clipboard.writeText(ctx.input);
      eventEmitter.emit('toast', 'copied');
    }),
    copyImageDataByPath: procedure.input(z.string()).mutation(async (ctx) => {
      const result = await utilsService.copyImageDataByPath(ctx.input);
      handleResultError(result, fileOperationErrorMappings);
      return true;
    }),
    downloadImageAsPng: procedure
      .input(
        z.object({
          pngBase64: z.string(),
          filenameWithoutExt: z.string(),
        }),
      )
      .mutation(async (ctx) => {
        const result = await utilsService.downloadImageAsPng(ctx.input);
        const downloadResult = handleResultErrorWithSilent(
          result,
          ['canceled'],
          fileOperationErrorMappings,
        );
        return downloadResult !== null;
      }),
    downloadImageAsPhotoLogPng: procedure
      .input(
        z.object({
          worldId: z.string().regex(/^wrld_.+$/),
          joinDateTime: z.date(),
          imageBase64: z.string(),
        }),
      )
      .mutation(async (ctx) => {
        const filename = `VRChat_${datefns.format(
          ctx.input.joinDateTime,
          'yyyy-MM-dd_HH-mm-ss.SSS',
        )}_${ctx.input.worldId}`;

        await utilsService.handlePngBase64WithCallback(
          {
            filenameWithoutExt: filename,
            pngBase64: ctx.input.imageBase64,
          },
          async (tempPngPath) => {
            const dialogResult = await utilsService.showSavePngDialog(filename);

            if (dialogResult.canceled || !dialogResult.filePath) {
              return;
            }

            // Write EXIF data with timezone
            await exiftool.writeDateTimeWithTimezone({
              filePath: tempPngPath,
              description: ctx.input.worldId,
              dateTimeOriginal: datefns.format(
                ctx.input.joinDateTime,
                'yyyy-MM-dd HH:mm:ss',
              ),
              timezoneOffset: datefns.format(ctx.input.joinDateTime, 'xxx'),
            });

            // Move the temp file to the final destination
            await utilsService.saveFileToPath(
              tempPngPath,
              dialogResult.filePath,
            );

            eventEmitter.emit('toast', 'downloaded');
          },
        );
      }),
    copyImageDataByBase64: procedure
      .input(
        z.object({
          pngBase64: z.string(),
          filenameWithoutExt: z.string(),
        }),
      )
      .mutation(async (ctx) => {
        const result = await utilsService.copyImageByBase64(ctx.input);
        handleResultError(result, fileOperationErrorMappings);
        return true;
      }),
    openPhotoPathWithPhotoApp: procedure
      .input(z.string())
      .mutation(async (ctx) => {
        const result = await utilsService.openPhotoPathWithPhotoApp(ctx.input);
        handleResultError(result, fileOperationErrorMappings);
        return true;
      }),
    openGetDirDialog: procedure.query(async () => {
      const result = await utilsService.openGetDirDialog();
      return result.match(
        (dirPath) => DirectoryPathSchema.parse(dirPath),
        () => null,
      );
    }),
    getDownloadsPath: procedure.query(async () => {
      return utilsService.getDownloadsPath();
    }),
    openPathWithAssociatedApp: procedure
      .input(z.string())
      .mutation(async (ctx) => {
        const result = await utilsService.openPathWithAssociatedApp(ctx.input);
        handleResultError(result, fileOperationErrorMappings);
        return true;
      }),
    copyMultipleImageDataByPath: procedure
      .input(z.array(z.string()))
      .mutation(async (ctx) => {
        const paths = ctx.input;
        consola.log(
          'copyMultipleImageDataByPath called with paths:',
          paths.length,
        );

        const result = await utilsService.copyMultipleFilesToClipboard(paths);
        handleResultError(result, fileOperationErrorMappings);
        return true;
      }),
  });
