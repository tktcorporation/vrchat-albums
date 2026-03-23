import { Transformer } from '@napi-rs/image';
import consola from 'consola';
import * as datefns from 'date-fns';
import { Effect, Exit } from 'effect';
import * as path from 'pathe';
import z from 'zod';

import { reloadMainWindow } from '../../../electronUtil';
import { runEffect } from '../../../lib/effectTRPC';
import { getClipboard } from '../../../lib/electronModules';
import {
  ERROR_CATEGORIES,
  ERROR_CODES,
  UserFacingError,
} from '../../../lib/errors';
import * as exiftool from '../../../lib/wrappedExifTool';
import type {
  DownloadImageError,
  FileIOError,
  OpenPathFailed,
} from '../errors';
import { eventEmitter, procedure, router as trpcRouter } from './../../../trpc';
import { DirectoryPathSchema } from './../../../valueObjects/index';
import * as utilsService from './../service';

/**
 * DownloadImageError → UserFacingError 変換ヘルパー
 */
const mapDownloadImageError = (e: DownloadImageError) =>
  UserFacingError.withStructuredInfo({
    code: ERROR_CODES.UNKNOWN,
    category: ERROR_CATEGORIES.UNKNOWN_ERROR,
    message: `File operation failed: ${e.message}`,
    userMessage: 'ファイル操作中にエラーが発生しました。',
    cause: e,
  });

/**
 * FileIOError → UserFacingError 変換ヘルパー
 */
const mapFileIOError = (e: FileIOError) =>
  UserFacingError.withStructuredInfo({
    code: ERROR_CODES.UNKNOWN,
    category: ERROR_CATEGORIES.UNKNOWN_ERROR,
    message: `File operation failed: ${e.message}`,
    userMessage: 'ファイル操作中にエラーが発生しました。',
    cause: e,
  });

/**
 * OpenPathFailed → UserFacingError 変換ヘルパー
 */
const mapOpenPathError = (e: OpenPathFailed) =>
  UserFacingError.withStructuredInfo({
    code: ERROR_CODES.FILE_NOT_FOUND,
    category: ERROR_CATEGORIES.FILE_NOT_FOUND,
    message: `Failed to open path: ${e.message}`,
    userMessage: 'ファイルを開けませんでした。',
    cause: e,
  });

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
      reloadMainWindow();
    }),
    getVRChatPhotoItemData: procedure.input(z.string()).query(async (ctx) => {
      const { readFile } = await import('node:fs/promises');
      const fileData = await readFile(ctx.input);
      const photoBuf = await new Transformer(fileData).resize(256).png();
      return `data:image/${path
        .extname(ctx.input)
        .replace('.', '')};base64,${Buffer.from(photoBuf).toString('base64')}`;
    }),
    copyTextToClipboard: procedure.input(z.string()).mutation(async (ctx) => {
      getClipboard().writeText(ctx.input);
      eventEmitter.emit('toast', 'copied');
    }),
    copyImageDataByPath: procedure.input(z.string()).mutation(async (ctx) => {
      await Effect.runPromise(utilsService.copyImageDataByPath(ctx.input));
      return true;
    }),
    /**
     * 単一の画像ファイルパスをクリップボードにコピーする
     * 画像データではなく、ファイルパスそのものをコピーします
     */
    copySingleImagePath: procedure.input(z.string()).mutation(async (ctx) => {
      await Effect.runPromise(
        utilsService.copyMultipleFilesToClipboard([ctx.input]),
      );
      return true;
    }),
    downloadImageAsPng: procedure
      .input(
        z.object({
          pngBase64: z.string(),
          filenameWithoutExt: z.string(),
        }),
      )
      .mutation(({ input }) =>
        runEffect(
          utilsService.downloadImageAsPng(input).pipe(
            Effect.map(() => true as const),
            // ユーザーキャンセルは silent → false を返す
            Effect.catchTag('OperationCanceled', () =>
              Effect.succeed(false as const),
            ),
            Effect.mapError(mapDownloadImageError),
          ),
        ),
      ),
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

        await Effect.runPromise(
          utilsService.handlePngBase64WithCallback(
            {
              filenameWithoutExt: filename,
              pngBase64: ctx.input.imageBase64,
            },
            async (tempPngPath) => {
              const dialogResult =
                await utilsService.showSavePngDialog(filename);

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
              await Effect.runPromise(
                utilsService.saveFileToPath(tempPngPath, dialogResult.filePath),
              );

              eventEmitter.emit('toast', 'downloaded');
            },
          ),
        );
      }),
    copyImageDataByBase64: procedure
      .input(
        z.object({
          pngBase64: z.string(),
          filenameWithoutExt: z.string(),
        }),
      )
      .mutation(({ input }) =>
        runEffect(
          utilsService.copyImageByBase64(input).pipe(
            Effect.map(() => true as const),
            Effect.mapError(mapFileIOError),
          ),
        ),
      ),
    openPhotoPathWithPhotoApp: procedure
      .input(z.string())
      .mutation(({ input }) =>
        runEffect(
          utilsService.openPhotoPathWithPhotoApp(input).pipe(
            Effect.map(() => true as const),
            Effect.mapError(mapOpenPathError),
          ),
        ),
      ),
    openGetDirDialog: procedure.query(async () => {
      const exit = await Effect.runPromiseExit(utilsService.openGetDirDialog());
      if (Exit.isSuccess(exit)) {
        return DirectoryPathSchema.parse(exit.value);
      }
      // canceled の場合は null を返す
      return null;
    }),
    getDownloadsPath: procedure.query(async () => {
      return utilsService.getDownloadsPath();
    }),
    openPathWithAssociatedApp: procedure
      .input(z.string())
      .mutation(({ input }) =>
        runEffect(
          utilsService.openPathWithAssociatedApp(input).pipe(
            Effect.map(() => true as const),
            Effect.mapError(mapOpenPathError),
          ),
        ),
      ),
    /**
     * 複数の画像ファイルパスをクリップボードにコピーする
     * 画像データではなく、ファイルパスそのものをコピーします
     * エクスプローラーやFinderで「貼り付け」操作ができるようになります
     */
    copyMultipleImagePaths: procedure
      .input(z.array(z.string()))
      .mutation(async (ctx) => {
        const paths = ctx.input;
        consola.log('copyMultipleImagePaths called with paths:', paths.length);

        await Effect.runPromise(
          utilsService.copyMultipleFilesToClipboard(paths),
        );
        return true;
      }),
    openGetFileDialog: procedure
      .input(z.array(z.enum(['openDirectory', 'openFile', 'multiSelections'])))
      .query(async (ctx) => {
        const exit = await Effect.runPromiseExit(
          utilsService.openGetFileDialog(ctx.input),
        );
        if (Exit.isSuccess(exit)) {
          return exit.value;
        }
        // canceled の場合は null を返す
        return null;
      }),
  });
