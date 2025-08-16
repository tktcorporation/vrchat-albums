const steps = [
  {
    number: '01',
    title: 'アプリをダウンロード',
    description: 'Windows対応。簡単にダウンロードしてすぐに使い始められます。',
  },
  {
    number: '02',
    title: 'フォルダを設定',
    description:
      'VRChatのログフォルダと写真が保存されているフォルダを指定します。',
  },
  {
    number: '03',
    title: '自動で整理完了',
    description:
      'アプリが自動的にログを解析し、写真をワールドごとに整理します。',
  },
];

function HowItWorks() {
  return (
    <section className="py-24 bg-white dark:bg-gray-950">
      <div className="container">
        <div className="text-center mb-12">
          <h2 className="text-4xl lg:text-5xl font-bold text-gray-900 dark:text-gray-100 mb-4">
            使い方は簡単
          </h2>
          <p className="text-lg text-gray-600 dark:text-gray-400 max-w-2xl mx-auto">
            3つのステップで、あなたのVRChat写真が美しく整理されます
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 relative mt-12">
          {steps.map((step, index) => (
            <div key={step.number} className="text-center relative">
              <div className="inline-flex items-center justify-center w-20 h-20 bg-gradient-to-br from-[#5865F2] to-[#7950F2] text-white text-2xl font-bold rounded-full mb-6">
                {step.number}
              </div>
              <h3 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-4">
                {step.title}
              </h3>
              <p className="text-base text-gray-600 dark:text-gray-400 leading-relaxed max-w-xs mx-auto">
                {step.description}
              </p>
              {index < steps.length - 1 && (
                <div className="hidden md:block absolute top-10 -right-10 text-3xl text-[#5865F2] opacity-50">
                  →
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export default HowItWorks;
