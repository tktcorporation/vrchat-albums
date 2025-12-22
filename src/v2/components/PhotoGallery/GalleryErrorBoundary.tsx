import { AlertCircle } from 'lucide-react';
import React from 'react';
import { trpcReact } from '@/trpc';
import { Button } from '../../../components/ui/button';
import PathSettings from '../settings/PathSettings';

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  errorMessage: string;
}

/**
 * ギャラリー表示中の予期せぬエラーを捕捉して再読み込みを促すバウンダリ。
 * PathSettings へのリンクも表示し、環境設定をやり直せるようにする。
 *
 * @see docs/error-handling.md - エラーハンドリング設計ドキュメント
 * @see electron/lib/errors.ts
 */
export class GalleryErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, errorMessage: '' };
  }

  static getDerivedStateFromError(_: Error): State {
    return { hasError: true, errorMessage: _.message };
  }

  render() {
    if (this.state.hasError) {
      const reloadWindow = trpcReact.electronUtil.reloadWindow.useMutation();

      return (
        <div className="flex min-h-[400px] items-center justify-center p-6">
          <div className="w-full max-w-2xl rounded-lg bg-red-50 p-8 shadow-lg">
            <div className="mb-6 flex items-center gap-3">
              <AlertCircle className="h-8 w-8 text-red-500" />
              <h2 className="text-xl font-semibold text-red-700">
                エラーが発生しました
              </h2>
            </div>

            <div className="mb-8 rounded-md bg-white p-4">
              <p className="font-mono text-sm text-red-500">
                {this.state.errorMessage}
              </p>
            </div>

            <PathSettings showRefreshAll={true} />

            <div className="mt-6 flex justify-end">
              <Button
                onClick={() => reloadWindow.mutate()}
                className="flex items-center gap-2 bg-red-600 hover:bg-red-700"
              >
                <span>ページを再読み込み</span>
              </Button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
