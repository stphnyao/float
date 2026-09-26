export const metadata = {
  title: "Float",
  description: "Revenue-linked merchant advances on Tempo testnet",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body
        style={{
          fontFamily: "system-ui, sans-serif",
          maxWidth: 880,
          margin: "0 auto",
          padding: "2rem 1rem",
        }}
      >
        {children}
      </body>
    </html>
  );
}
