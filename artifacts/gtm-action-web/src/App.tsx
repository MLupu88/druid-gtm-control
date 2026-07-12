import { SiteNav } from "@/components/layout/SiteNav";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { Hero } from "@/components/sections/Hero";
import { ProblemStatement } from "@/components/sections/ProblemStatement";
import { HowItWorks } from "@/components/sections/HowItWorks";
import { HumanInTheLoop } from "@/components/sections/HumanInTheLoop";
import { SalesAcceptedMql } from "@/components/sections/SalesAcceptedMql";
import { ValueImpact } from "@/components/sections/ValueImpact";
import { ProductCapabilities } from "@/components/sections/ProductCapabilities";
import { ConnectedEcosystem } from "@/components/sections/ConnectedEcosystem";
import { Reporting } from "@/components/sections/Reporting";
import { FinalCta } from "@/components/sections/FinalCta";

export default function App() {
  return (
    <div id="top" className="min-h-screen bg-navy-900 text-white">
      <SiteNav />
      <main>
        <Hero />
        <ProblemStatement />
        <HowItWorks />
        <HumanInTheLoop />
        <SalesAcceptedMql />
        <ValueImpact />
        <ProductCapabilities />
        <ConnectedEcosystem />
        <Reporting />
        <FinalCta />
      </main>
      <SiteFooter />
    </div>
  );
}
