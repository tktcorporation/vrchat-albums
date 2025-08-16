function Hero() {
  return (
    <section className="py-24 bg-gradient-to-br from-[#667eea] to-[#764ba2] text-white overflow-hidden relative">
      {/* Background pattern */}
      <div
        className="absolute inset-0 z-0 opacity-5"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='1'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
        }}
      />

      <div className="container relative z-10">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
          <div>
            <h1 className="text-5xl lg:text-6xl font-extrabold leading-tight mb-4">
              VRChat Albums
              <span className="block text-2xl lg:text-3xl font-normal mt-2 opacity-90">
                VRChatの思い出を、美しく整理
              </span>
            </h1>
            <p className="text-lg leading-relaxed mb-8 opacity-95">
              VRChatで撮影した大切な写真を、訪れたワールドごとに自動整理。
              いつ、どこで、誰と過ごした思い出なのか、すぐに見つけられます。
            </p>
            <div className="flex flex-wrap gap-4 mb-6">
              <a
                href="#download"
                className="inline-block px-8 py-4 rounded-full font-semibold no-underline transition-all duration-250 bg-white text-[#764ba2] hover:-translate-y-0.5 hover:shadow-lg"
              >
                無料でダウンロード
              </a>
              <a
                href="#features"
                className="inline-block px-8 py-4 rounded-full font-semibold no-underline transition-all duration-250 bg-transparent text-white border-2 border-white hover:bg-white hover:text-[#764ba2]"
              >
                機能を見る
              </a>
            </div>
            <div className="flex flex-wrap gap-2">
              <span className="inline-block px-4 py-1 bg-white/20 rounded-full text-sm backdrop-blur-[10px]">
                Windows対応
              </span>
            </div>
          </div>
          <div className="relative">
            <img
              src="./VRChatAlbums-finalized.png"
              alt="VRChat Albums スクリーンショット"
              className="w-full h-auto rounded-lg shadow-2xl transition-transform duration-[350ms] hover:transform-none"
              style={{
                transform: 'perspective(1000px) rotateY(-5deg)',
                boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
              }}
            />
          </div>
        </div>
      </div>
    </section>
  );
}

export default Hero;
