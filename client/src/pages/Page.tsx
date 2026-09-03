type PageProps = {
  title: string;
  description: string;
};

export default function Page({ title, description }: PageProps) {
  return (
    <section className="page">
      <h1>{title}</h1>
      <p>{description}</p>
      <div className="placeholder-card">
        Content coming in a later phase.
      </div>
    </section>
  );
}
