import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import fs from "fs";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../src/types/database.types";
import { buildCompositionKey } from "../src/lib/clinical/normalize";
import { isNtiComposition, isScheduleHComposition } from "../src/lib/clinical/nti-list";

// ============================================================================
// 1. Supabase Admin Client
// ============================================================================
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error("❌ Fatal Error: Missing Supabase admin credentials.");
  console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be defined in .env.local");
  process.exit(1);
}

const supabase = createClient<Database>(supabaseUrl, supabaseServiceKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

// ============================================================================
// 2. Types & Interfaces
// ============================================================================
interface RawMedicineInput {
  brand_name: string;
  manufacturer?: string | null;
  pack_size?: string | null;
  composition_display: string;
  mrp: number;
  is_jan_aushadhi?: boolean;
  manually_verified?: boolean;
}

type MedicineInsert = Database["public"]["Tables"]["medicines"]["Insert"];

// ============================================================================
// 3. Curated Indian Outpatient Dataset (100% hardcoded local array)
// ============================================================================
const CURATED_MEDICINES: RawMedicineInput[] = [
  // --------------------------------------------------------------------------
  // Group 1: Paracetamol 650mg (Fever & Pain)
  // --------------------------------------------------------------------------
  {
    brand_name: "Dolo 650",
    manufacturer: "Micro Labs Ltd",
    pack_size: "15 tablets",
    composition_display: "Paracetamol 650mg",
    mrp: 34.0,
    is_jan_aushadhi: false,
  },
  {
    brand_name: "Calpol 650",
    manufacturer: "GlaxoSmithKline",
    pack_size: "15 tablets",
    composition_display: "Paracetamol 650mg",
    mrp: 32.5,
    is_jan_aushadhi: false,
  },
  {
    brand_name: "Crocin Advance 650",
    manufacturer: "GlaxoSmithKline",
    pack_size: "15 tablets",
    composition_display: "Paracetamol 650mg",
    mrp: 33.5,
    is_jan_aushadhi: false,
  },
  {
    brand_name: "Pacimol 650",
    manufacturer: "Ipca Laboratories",
    pack_size: "15 tablets",
    composition_display: "Paracetamol 650mg",
    mrp: 30.0,
    is_jan_aushadhi: false,
  },
  {
    brand_name: "Jan Aushadhi Paracetamol 650",
    manufacturer: "PMBI (Pradhan Mantri Bhartiya Janaushadhi Pariyojana)",
    pack_size: "10 tablets",
    composition_display: "Paracetamol 650mg",
    mrp: 8.5,
    is_jan_aushadhi: true,
  },

  // --------------------------------------------------------------------------
  // Group 2: Paracetamol 500mg (Mild Fever & Pain)
  // --------------------------------------------------------------------------
  {
    brand_name: "Crocin 500",
    manufacturer: "GlaxoSmithKline",
    pack_size: "15 tablets",
    composition_display: "Paracetamol 500mg",
    mrp: 22.0,
    is_jan_aushadhi: false,
  },
  {
    brand_name: "Calpol 500",
    manufacturer: "GlaxoSmithKline",
    pack_size: "15 tablets",
    composition_display: "Paracetamol 500mg",
    mrp: 20.0,
    is_jan_aushadhi: false,
  },
  {
    brand_name: "Jan Aushadhi Paracetamol 500",
    manufacturer: "PMBI",
    pack_size: "10 tablets",
    composition_display: "Paracetamol 500mg",
    mrp: 5.5,
    is_jan_aushadhi: true,
  },

  // --------------------------------------------------------------------------
  // Group 3: Amoxicillin 500mg + Clavulanic Acid 125mg (Broad Spectrum Antibiotic)
  // --------------------------------------------------------------------------
  {
    brand_name: "Augmentin 625 Duo",
    manufacturer: "GlaxoSmithKline",
    pack_size: "10 tablets",
    composition_display: "Amoxicillin 500mg + Clavulanic Acid 125mg",
    mrp: 223.0,
    is_jan_aushadhi: false,
  },
  {
    brand_name: "Moxikind-CV 625",
    manufacturer: "Mankind Pharma",
    pack_size: "10 tablets",
    composition_display: "Amoxicillin 500mg + Clavulanic Acid 125mg",
    mrp: 178.0,
    is_jan_aushadhi: false,
  },
  {
    brand_name: "Clavam 625",
    manufacturer: "Alkem Laboratories",
    pack_size: "10 tablets",
    composition_display: "Amoxicillin 500mg + Clavulanic Acid 125mg",
    mrp: 210.0,
    is_jan_aushadhi: false,
  },
  {
    brand_name: "Jan Aushadhi Amoxycillin and Potassium Clavulanate 625",
    manufacturer: "PMBI",
    pack_size: "10 tablets",
    composition_display: "Amoxicillin 500mg + Clavulanic Acid 125mg",
    mrp: 62.0,
    is_jan_aushadhi: true,
  },

  // --------------------------------------------------------------------------
  // Group 4: Pantoprazole 40mg (Proton Pump Inhibitor / Acid Reflux)
  // --------------------------------------------------------------------------
  {
    brand_name: "Pan 40",
    manufacturer: "Alkem Laboratories",
    pack_size: "15 tablets",
    composition_display: "Pantoprazole 40mg",
    mrp: 165.0,
    is_jan_aushadhi: false,
  },
  {
    brand_name: "Pantocid 40",
    manufacturer: "Sun Pharma",
    pack_size: "15 tablets",
    composition_display: "Pantoprazole 40mg",
    mrp: 160.0,
    is_jan_aushadhi: false,
  },
  {
    brand_name: "Pantodac 40",
    manufacturer: "Zydus Cadila",
    pack_size: "15 tablets",
    composition_display: "Pantoprazole 40mg",
    mrp: 150.0,
    is_jan_aushadhi: false,
  },
  {
    brand_name: "Jan Aushadhi Pantoprazole 40",
    manufacturer: "PMBI",
    pack_size: "10 tablets",
    composition_display: "Pantoprazole 40mg",
    mrp: 22.0,
    is_jan_aushadhi: true,
  },

  // --------------------------------------------------------------------------
  // Group 5: Pantoprazole 40mg + Domperidone 30mg (GERD + Gastric Motility)
  // --------------------------------------------------------------------------
  {
    brand_name: "Pan-D",
    manufacturer: "Alkem Laboratories",
    pack_size: "15 capsules",
    composition_display: "Pantoprazole 40mg + Domperidone 30mg",
    mrp: 215.0,
    is_jan_aushadhi: false,
  },
  {
    brand_name: "Pantocid-D SR",
    manufacturer: "Sun Pharma",
    pack_size: "10 capsules",
    composition_display: "Pantoprazole 40mg + Domperidone 30mg",
    mrp: 145.0,
    is_jan_aushadhi: false,
  },
  {
    brand_name: "Pantocar-D",
    manufacturer: "Micro Labs Ltd",
    pack_size: "10 capsules",
    composition_display: "Pantoprazole 40mg + Domperidone 30mg",
    mrp: 130.0,
    is_jan_aushadhi: false,
  },
  {
    brand_name: "Jan Aushadhi Pantoprazole and Domperidone SR",
    manufacturer: "PMBI",
    pack_size: "10 capsules",
    composition_display: "Pantoprazole 40mg + Domperidone 30mg",
    mrp: 35.0,
    is_jan_aushadhi: true,
  },

  // --------------------------------------------------------------------------
  // Group 6: Telmisartan 40mg (Hypertension)
  // --------------------------------------------------------------------------
  {
    brand_name: "Telma 40",
    manufacturer: "Glenmark Pharmaceuticals",
    pack_size: "15 tablets",
    composition_display: "Telmisartan 40mg",
    mrp: 140.0,
    is_jan_aushadhi: false,
  },
  {
    brand_name: "Telmikind 40",
    manufacturer: "Mankind Pharma",
    pack_size: "10 tablets",
    composition_display: "Telmisartan 40mg",
    mrp: 58.0,
    is_jan_aushadhi: false,
  },
  {
    brand_name: "Telpres 40",
    manufacturer: "Abbott",
    pack_size: "15 tablets",
    composition_display: "Telmisartan 40mg",
    mrp: 135.0,
    is_jan_aushadhi: false,
  },
  {
    brand_name: "Jan Aushadhi Telmisartan 40",
    manufacturer: "PMBI",
    pack_size: "10 tablets",
    composition_display: "Telmisartan 40mg",
    mrp: 14.0,
    is_jan_aushadhi: true,
  },

  // --------------------------------------------------------------------------
  // Group 7: Telmisartan 40mg + Amlodipine 5mg (Combination Antihypertensive)
  // --------------------------------------------------------------------------
  {
    brand_name: "Telma-AM",
    manufacturer: "Glenmark Pharmaceuticals",
    pack_size: "15 tablets",
    composition_display: "Telmisartan 40mg + Amlodipine 5mg",
    mrp: 230.0,
    is_jan_aushadhi: false,
  },
  {
    brand_name: "Telmikind-AM",
    manufacturer: "Mankind Pharma",
    pack_size: "10 tablets",
    composition_display: "Telmisartan 40mg + Amlodipine 5mg",
    mrp: 85.0,
    is_jan_aushadhi: false,
  },
  {
    brand_name: "Jan Aushadhi Telmisartan and Amlodipine",
    manufacturer: "PMBI",
    pack_size: "10 tablets",
    composition_display: "Telmisartan 40mg + Amlodipine 5mg",
    mrp: 28.0,
    is_jan_aushadhi: true,
  },

  // --------------------------------------------------------------------------
  // Group 8: Amlodipine 5mg (Calcium Channel Blocker / Hypertension)
  // --------------------------------------------------------------------------
  {
    brand_name: "Amlong 5",
    manufacturer: "Micro Labs Ltd",
    pack_size: "15 tablets",
    composition_display: "Amlodipine 5mg",
    mrp: 52.0,
    is_jan_aushadhi: false,
  },
  {
    brand_name: "Stamlo 5",
    manufacturer: "Dr. Reddy's Laboratories",
    pack_size: "15 tablets",
    composition_display: "Amlodipine 5mg",
    mrp: 75.0,
    is_jan_aushadhi: false,
  },
  {
    brand_name: "Jan Aushadhi Amlodipine 5",
    manufacturer: "PMBI",
    pack_size: "10 tablets",
    composition_display: "Amlodipine 5mg",
    mrp: 6.0,
    is_jan_aushadhi: true,
  },

  // --------------------------------------------------------------------------
  // Group 9: Metformin 500mg (Type 2 Diabetes)
  // --------------------------------------------------------------------------
  {
    brand_name: "Glycomet 500 SR",
    manufacturer: "USV Pvt Ltd",
    pack_size: "20 tablets",
    composition_display: "Metformin 500mg",
    mrp: 54.0,
    is_jan_aushadhi: false,
  },
  {
    brand_name: "Obimet 500 SR",
    manufacturer: "Abbott",
    pack_size: "20 tablets",
    composition_display: "Metformin 500mg",
    mrp: 48.0,
    is_jan_aushadhi: false,
  },
  {
    brand_name: "Jan Aushadhi Metformin 500 SR",
    manufacturer: "PMBI",
    pack_size: "10 tablets",
    composition_display: "Metformin 500mg",
    mrp: 8.0,
    is_jan_aushadhi: true,
  },

  // --------------------------------------------------------------------------
  // Group 10: Glimepiride 1mg + Metformin 500mg (Oral Antidiabetic Dual Therapy)
  // --------------------------------------------------------------------------
  {
    brand_name: "Glycomet-GP 1",
    manufacturer: "USV Pvt Ltd",
    pack_size: "15 tablets",
    composition_display: "Glimepiride 1mg + Metformin 500mg",
    mrp: 125.0,
    is_jan_aushadhi: false,
  },
  {
    brand_name: "Glimisave M1",
    manufacturer: "Eris Lifesciences",
    pack_size: "15 tablets",
    composition_display: "Glimepiride 1mg + Metformin 500mg",
    mrp: 115.0,
    is_jan_aushadhi: false,
  },
  {
    brand_name: "Jan Aushadhi Glimepiride and Metformin 1",
    manufacturer: "PMBI",
    pack_size: "10 tablets",
    composition_display: "Glimepiride 1mg + Metformin 500mg",
    mrp: 22.0,
    is_jan_aushadhi: true,
  },

  // --------------------------------------------------------------------------
  // Group 11: Glimepiride 2mg + Metformin 500mg (Dual Therapy Step-up)
  // --------------------------------------------------------------------------
  {
    brand_name: "Glycomet-GP 2",
    manufacturer: "USV Pvt Ltd",
    pack_size: "15 tablets",
    composition_display: "Glimepiride 2mg + Metformin 500mg",
    mrp: 160.0,
    is_jan_aushadhi: false,
  },
  {
    brand_name: "Glimisave M2",
    manufacturer: "Eris Lifesciences",
    pack_size: "15 tablets",
    composition_display: "Glimepiride 2mg + Metformin 500mg",
    mrp: 145.0,
    is_jan_aushadhi: false,
  },
  {
    brand_name: "Jan Aushadhi Glimepiride and Metformin 2",
    manufacturer: "PMBI",
    pack_size: "10 tablets",
    composition_display: "Glimepiride 2mg + Metformin 500mg",
    mrp: 26.0,
    is_jan_aushadhi: true,
  },

  // --------------------------------------------------------------------------
  // Group 12: Atorvastatin 10mg (Cholesterol / Statin)
  // --------------------------------------------------------------------------
  {
    brand_name: "Atorva 10",
    manufacturer: "Zydus Cadila",
    pack_size: "15 tablets",
    composition_display: "Atorvastatin 10mg",
    mrp: 115.0,
    is_jan_aushadhi: false,
  },
  {
    brand_name: "Lipikind 10",
    manufacturer: "Mankind Pharma",
    pack_size: "15 tablets",
    composition_display: "Atorvastatin 10mg",
    mrp: 68.0,
    is_jan_aushadhi: false,
  },
  {
    brand_name: "Storvas 10",
    manufacturer: "Sun Pharma",
    pack_size: "15 tablets",
    composition_display: "Atorvastatin 10mg",
    mrp: 120.0,
    is_jan_aushadhi: false,
  },
  {
    brand_name: "Jan Aushadhi Atorvastatin 10",
    manufacturer: "PMBI",
    pack_size: "10 tablets",
    composition_display: "Atorvastatin 10mg",
    mrp: 12.0,
    is_jan_aushadhi: true,
  },

  // --------------------------------------------------------------------------
  // Group 13: Rosuvastatin 10mg (Potent Lipid Lowering)
  // --------------------------------------------------------------------------
  {
    brand_name: "Rosuvas 10",
    manufacturer: "Sun Pharma",
    pack_size: "15 tablets",
    composition_display: "Rosuvastatin 10mg",
    mrp: 245.0,
    is_jan_aushadhi: false,
  },
  {
    brand_name: "Rozavel 10",
    manufacturer: "Sun Pharma",
    pack_size: "10 tablets",
    composition_display: "Rosuvastatin 10mg",
    mrp: 155.0,
    is_jan_aushadhi: false,
  },
  {
    brand_name: "Rosave 10",
    manufacturer: "Alembic Pharmaceuticals",
    pack_size: "15 tablets",
    composition_display: "Rosuvastatin 10mg",
    mrp: 230.0,
    is_jan_aushadhi: false,
  },
  {
    brand_name: "Jan Aushadhi Rosuvastatin 10",
    manufacturer: "PMBI",
    pack_size: "10 tablets",
    composition_display: "Rosuvastatin 10mg",
    mrp: 24.0,
    is_jan_aushadhi: true,
  },

  // --------------------------------------------------------------------------
  // Group 14: Azithromycin 500mg (Macrolide Antibiotic)
  // --------------------------------------------------------------------------
  {
    brand_name: "Azithral 500",
    manufacturer: "Alembic Pharmaceuticals",
    pack_size: "5 tablets",
    composition_display: "Azithromycin 500mg",
    mrp: 132.0,
    is_jan_aushadhi: false,
  },
  {
    brand_name: "Azee 500",
    manufacturer: "Cipla",
    pack_size: "5 tablets",
    composition_display: "Azithromycin 500mg",
    mrp: 130.0,
    is_jan_aushadhi: false,
  },
  {
    brand_name: "Zady 500",
    manufacturer: "Mankind Pharma",
    pack_size: "5 tablets",
    composition_display: "Azithromycin 500mg",
    mrp: 110.0,
    is_jan_aushadhi: false,
  },
  {
    brand_name: "Jan Aushadhi Azithromycin 500",
    manufacturer: "PMBI",
    pack_size: "3 tablets",
    composition_display: "Azithromycin 500mg",
    mrp: 35.0,
    is_jan_aushadhi: true,
  },

  // --------------------------------------------------------------------------
  // Group 15: Calcium Carbonate 500mg + Vitamin D3 250IU (Bone Health OTC)
  // --------------------------------------------------------------------------
  {
    brand_name: "Shelcal 500",
    manufacturer: "Torrent Pharmaceuticals",
    pack_size: "15 tablets",
    composition_display: "Calcium Carbonate 500mg + Vitamin D3 250IU",
    mrp: 135.0,
    is_jan_aushadhi: false,
  },
  {
    brand_name: "Cipcal 500",
    manufacturer: "Cipla",
    pack_size: "15 tablets",
    composition_display: "Calcium Carbonate 500mg + Vitamin D3 250IU",
    mrp: 110.0,
    is_jan_aushadhi: false,
  },
  {
    brand_name: "Jan Aushadhi Calcium and Vitamin D3",
    manufacturer: "PMBI",
    pack_size: "10 tablets",
    composition_display: "Calcium Carbonate 500mg + Vitamin D3 250IU",
    mrp: 20.0,
    is_jan_aushadhi: true,
  },

  // --------------------------------------------------------------------------
  // Group 16: Montelukast 10mg + Levocetirizine 5mg (Allergic Rhinitis / Asthma)
  // --------------------------------------------------------------------------
  {
    brand_name: "Montair-LC",
    manufacturer: "Cipla",
    pack_size: "10 tablets",
    composition_display: "Montelukast 10mg + Levocetirizine 5mg",
    mrp: 185.0,
    is_jan_aushadhi: false,
  },
  {
    brand_name: "Montek-LC",
    manufacturer: "Sun Pharma",
    pack_size: "10 tablets",
    composition_display: "Montelukast 10mg + Levocetirizine 5mg",
    mrp: 190.0,
    is_jan_aushadhi: false,
  },
  {
    brand_name: "Telekast-L",
    manufacturer: "Lupin",
    pack_size: "10 tablets",
    composition_display: "Montelukast 10mg + Levocetirizine 5mg",
    mrp: 175.0,
    is_jan_aushadhi: false,
  },
  {
    brand_name: "Jan Aushadhi Montelukast and Levocetirizine",
    manufacturer: "PMBI",
    pack_size: "10 tablets",
    composition_display: "Montelukast 10mg + Levocetirizine 5mg",
    mrp: 32.0,
    is_jan_aushadhi: true,
  },

  // --------------------------------------------------------------------------
  // Group 17: Fexofenadine 120mg (Non-sedating Antihistamine)
  // --------------------------------------------------------------------------
  {
    brand_name: "Allegra 120",
    manufacturer: "Sanofi India",
    pack_size: "10 tablets",
    composition_display: "Fexofenadine 120mg",
    mrp: 218.0,
    is_jan_aushadhi: false,
  },
  {
    brand_name: "Fexova 120",
    manufacturer: "Ipca Laboratories",
    pack_size: "10 tablets",
    composition_display: "Fexofenadine 120mg",
    mrp: 145.0,
    is_jan_aushadhi: false,
  },
  {
    brand_name: "Jan Aushadhi Fexofenadine 120",
    manufacturer: "PMBI",
    pack_size: "10 tablets",
    composition_display: "Fexofenadine 120mg",
    mrp: 35.0,
    is_jan_aushadhi: true,
  },

  // --------------------------------------------------------------------------
  // Group 18: Cetirizine 10mg (Allergies OTC)
  // --------------------------------------------------------------------------
  {
    brand_name: "Zyrtec 10",
    manufacturer: "Dr. Reddy's Laboratories",
    pack_size: "10 tablets",
    composition_display: "Cetirizine 10mg",
    mrp: 23.0,
    is_jan_aushadhi: false,
  },
  {
    brand_name: "Cetzine 10",
    manufacturer: "GlaxoSmithKline",
    pack_size: "10 tablets",
    composition_display: "Cetirizine 10mg",
    mrp: 21.0,
    is_jan_aushadhi: false,
  },
  {
    brand_name: "Alerid 10",
    manufacturer: "Cipla",
    pack_size: "10 tablets",
    composition_display: "Cetirizine 10mg",
    mrp: 20.0,
    is_jan_aushadhi: false,
  },
  {
    brand_name: "Jan Aushadhi Cetirizine 10",
    manufacturer: "PMBI",
    pack_size: "10 tablets",
    composition_display: "Cetirizine 10mg",
    mrp: 4.5,
    is_jan_aushadhi: true,
  },

  // --------------------------------------------------------------------------
  // Group 19: Metronidazole 400mg (Amoebic / Anaerobic Infections)
  // --------------------------------------------------------------------------
  {
    brand_name: "Metrogyl 400",
    manufacturer: "J.B. Chemicals",
    pack_size: "15 tablets",
    composition_display: "Metronidazole 400mg",
    mrp: 24.0,
    is_jan_aushadhi: false,
  },
  {
    brand_name: "Flagyl 400",
    manufacturer: "Abbott",
    pack_size: "15 tablets",
    composition_display: "Metronidazole 400mg",
    mrp: 25.0,
    is_jan_aushadhi: false,
  },
  {
    brand_name: "Jan Aushadhi Metronidazole 400",
    manufacturer: "PMBI",
    pack_size: "10 tablets",
    composition_display: "Metronidazole 400mg",
    mrp: 5.0,
    is_jan_aushadhi: true,
  },

  // --------------------------------------------------------------------------
  // Group 20: Cefixime 200mg (Oral Cephalosporin Antibiotic)
  // --------------------------------------------------------------------------
  {
    brand_name: "Taxim-O 200",
    manufacturer: "Alkem Laboratories",
    pack_size: "10 tablets",
    composition_display: "Cefixime 200mg",
    mrp: 180.0,
    is_jan_aushadhi: false,
  },
  {
    brand_name: "Zifi 200",
    manufacturer: "FDC Ltd",
    pack_size: "10 tablets",
    composition_display: "Cefixime 200mg",
    mrp: 175.0,
    is_jan_aushadhi: false,
  },
  {
    brand_name: "Mahacef 200",
    manufacturer: "Mankind Pharma",
    pack_size: "10 tablets",
    composition_display: "Cefixime 200mg",
    mrp: 120.0,
    is_jan_aushadhi: false,
  },
  {
    brand_name: "Jan Aushadhi Cefixime 200",
    manufacturer: "PMBI",
    pack_size: "10 tablets",
    composition_display: "Cefixime 200mg",
    mrp: 45.0,
    is_jan_aushadhi: true,
  },

  // --------------------------------------------------------------------------
  // Group 21: Ibuprofen 400mg + Paracetamol 325mg (Pain & Inflammation)
  // --------------------------------------------------------------------------
  {
    brand_name: "Combiflam",
    manufacturer: "Sanofi India",
    pack_size: "20 tablets",
    composition_display: "Ibuprofen 400mg + Paracetamol 325mg",
    mrp: 47.0,
    is_jan_aushadhi: false,
  },
  {
    brand_name: "Ibugesic Plus",
    manufacturer: "Cipla",
    pack_size: "20 tablets",
    composition_display: "Ibuprofen 400mg + Paracetamol 325mg",
    mrp: 42.0,
    is_jan_aushadhi: false,
  },
  {
    brand_name: "Jan Aushadhi Ibuprofen and Paracetamol",
    manufacturer: "PMBI",
    pack_size: "10 tablets",
    composition_display: "Ibuprofen 400mg + Paracetamol 325mg",
    mrp: 9.0,
    is_jan_aushadhi: true,
  },

  // --------------------------------------------------------------------------
  // Group 22: Aceclofenac 100mg + Paracetamol 325mg + Serratiopeptidase 15mg
  // --------------------------------------------------------------------------
  {
    brand_name: "Zerodol-SP",
    manufacturer: "Ipca Laboratories",
    pack_size: "10 tablets",
    composition_display: "Aceclofenac 100mg + Paracetamol 325mg + Serratiopeptidase 15mg",
    mrp: 125.0,
    is_jan_aushadhi: false,
  },
  {
    brand_name: "Aceclo-SP",
    manufacturer: "Aristo Pharmaceuticals",
    pack_size: "10 tablets",
    composition_display: "Aceclofenac 100mg + Paracetamol 325mg + Serratiopeptidase 15mg",
    mrp: 118.0,
    is_jan_aushadhi: false,
  },
  {
    brand_name: "Signoflam",
    manufacturer: "Lupin",
    pack_size: "10 tablets",
    composition_display: "Aceclofenac 100mg + Paracetamol 325mg + Serratiopeptidase 15mg",
    mrp: 130.0,
    is_jan_aushadhi: false,
  },
  {
    brand_name: "Jan Aushadhi Aceclofenac, Paracetamol and Serratiopeptidase",
    manufacturer: "PMBI",
    pack_size: "10 tablets",
    composition_display: "Aceclofenac 100mg + Paracetamol 325mg + Serratiopeptidase 15mg",
    mrp: 34.0,
    is_jan_aushadhi: true,
  },

  // --------------------------------------------------------------------------
  // Group 23: Ranitidine 150mg (H2 Receptor Antagonist / Acidity)
  // --------------------------------------------------------------------------
  {
    brand_name: "Rantac 150",
    manufacturer: "J.B. Chemicals",
    pack_size: "30 tablets",
    composition_display: "Ranitidine 150mg",
    mrp: 45.0,
    is_jan_aushadhi: false,
  },
  {
    brand_name: "Zinetac 150",
    manufacturer: "GlaxoSmithKline",
    pack_size: "30 tablets",
    composition_display: "Ranitidine 150mg",
    mrp: 42.0,
    is_jan_aushadhi: false,
  },
  {
    brand_name: "Jan Aushadhi Ranitidine 150",
    manufacturer: "PMBI",
    pack_size: "10 tablets",
    composition_display: "Ranitidine 150mg",
    mrp: 6.0,
    is_jan_aushadhi: true,
  },

  // --------------------------------------------------------------------------
  // Group 24: Aspirin 75mg (Antiplatelet / Cardiovascular Prophylaxis)
  // --------------------------------------------------------------------------
  {
    brand_name: "EcoSprin 75",
    manufacturer: "USV Pvt Ltd",
    pack_size: "14 tablets",
    composition_display: "Aspirin 75mg",
    mrp: 6.0,
    is_jan_aushadhi: false,
  },
  {
    brand_name: "Delisprin 75",
    manufacturer: "Aristo Pharmaceuticals",
    pack_size: "14 tablets",
    composition_display: "Aspirin 75mg",
    mrp: 5.5,
    is_jan_aushadhi: false,
  },
  {
    brand_name: "Jan Aushadhi Aspirin 75",
    manufacturer: "PMBI",
    pack_size: "14 tablets",
    composition_display: "Aspirin 75mg",
    mrp: 2.5,
    is_jan_aushadhi: true,
  },

  // --------------------------------------------------------------------------
  // Group 25: Bisoprolol 5mg (Beta Blocker / Hypertension & Angina)
  // --------------------------------------------------------------------------
  {
    brand_name: "Concor 5",
    manufacturer: "Merck",
    pack_size: "10 tablets",
    composition_display: "Bisoprolol 5mg",
    mrp: 115.0,
    is_jan_aushadhi: false,
  },
  {
    brand_name: "Bisoheart 5",
    manufacturer: "Mankind Pharma",
    pack_size: "10 tablets",
    composition_display: "Bisoprolol 5mg",
    mrp: 70.0,
    is_jan_aushadhi: false,
  },
  {
    brand_name: "Jan Aushadhi Bisoprolol 5",
    manufacturer: "PMBI",
    pack_size: "10 tablets",
    composition_display: "Bisoprolol 5mg",
    mrp: 18.0,
    is_jan_aushadhi: true,
  },

  // --------------------------------------------------------------------------
  // Group 26: Ciprofloxacin 500mg (Fluoroquinolone Antibiotic)
  // --------------------------------------------------------------------------
  {
    brand_name: "Ciplox 500",
    manufacturer: "Cipla",
    pack_size: "10 tablets",
    composition_display: "Ciprofloxacin 500mg",
    mrp: 45.0,
    is_jan_aushadhi: false,
  },
  {
    brand_name: "Cifran 500",
    manufacturer: "Sun Pharma",
    pack_size: "10 tablets",
    composition_display: "Ciprofloxacin 500mg",
    mrp: 48.0,
    is_jan_aushadhi: false,
  },
  {
    brand_name: "Jan Aushadhi Ciprofloxacin 500",
    manufacturer: "PMBI",
    pack_size: "10 tablets",
    composition_display: "Ciprofloxacin 500mg",
    mrp: 15.0,
    is_jan_aushadhi: true,
  },

  // --------------------------------------------------------------------------
  // Group 27: Ofloxacin 200mg + Ornidazole 500mg (Gastrointestinal Antibacterial)
  // --------------------------------------------------------------------------
  {
    brand_name: "O2",
    manufacturer: "Medley Pharmaceuticals",
    pack_size: "10 tablets",
    composition_display: "Ofloxacin 200mg + Ornidazole 500mg",
    mrp: 150.0,
    is_jan_aushadhi: false,
  },
  {
    brand_name: "Zenflox-OZ",
    manufacturer: "Mankind Pharma",
    pack_size: "10 tablets",
    composition_display: "Ofloxacin 200mg + Ornidazole 500mg",
    mrp: 125.0,
    is_jan_aushadhi: false,
  },
  {
    brand_name: "Jan Aushadhi Ofloxacin and Ornidazole",
    manufacturer: "PMBI",
    pack_size: "10 tablets",
    composition_display: "Ofloxacin 200mg + Ornidazole 500mg",
    mrp: 32.0,
    is_jan_aushadhi: true,
  },

  // --------------------------------------------------------------------------
  // Group 28: Doxycycline 100mg (Tetracycline Antibiotic)
  // --------------------------------------------------------------------------
  {
    brand_name: "Doxicip 100",
    manufacturer: "Cipla",
    pack_size: "10 capsules",
    composition_display: "Doxycycline 100mg",
    mrp: 58.0,
    is_jan_aushadhi: false,
  },
  {
    brand_name: "Doxt-SL",
    manufacturer: "Dr. Reddy's Laboratories",
    pack_size: "10 capsules",
    composition_display: "Doxycycline 100mg",
    mrp: 62.0,
    is_jan_aushadhi: false,
  },
  {
    brand_name: "Jan Aushadhi Doxycycline 100",
    manufacturer: "PMBI",
    pack_size: "10 capsules",
    composition_display: "Doxycycline 100mg",
    mrp: 16.0,
    is_jan_aushadhi: true,
  },

  // --------------------------------------------------------------------------
  // Group 29: Oral Rehydration Salts (WHO Formula Dehydration OTC)
  // --------------------------------------------------------------------------
  {
    brand_name: "Electral Powder",
    manufacturer: "FDC Ltd",
    pack_size: "21.8g sachet",
    composition_display: "Oral Rehydration Salts IP",
    mrp: 23.0,
    is_jan_aushadhi: false,
  },
  {
    brand_name: "Prolyte ORS",
    manufacturer: "Cipla",
    pack_size: "21.8g sachet",
    composition_display: "Oral Rehydration Salts IP",
    mrp: 22.0,
    is_jan_aushadhi: false,
  },
  {
    brand_name: "Jan Aushadhi ORS",
    manufacturer: "PMBI",
    pack_size: "21.8g sachet",
    composition_display: "Oral Rehydration Salts IP",
    mrp: 7.0,
    is_jan_aushadhi: true,
  },

  // --------------------------------------------------------------------------
  // Group 30: Cholecalciferol (Vitamin D3) 60000 IU (Weekly High-Dose OTC)
  // --------------------------------------------------------------------------
  {
    brand_name: "Calcirol Sachet 60000 IU",
    manufacturer: "Cadila Healthcare",
    pack_size: "1g sachet",
    composition_display: "Cholecalciferol 60000 IU",
    mrp: 58.0,
    is_jan_aushadhi: false,
  },
  {
    brand_name: "D3 Must 60K",
    manufacturer: "Mankind Pharma",
    pack_size: "4 capsules",
    composition_display: "Cholecalciferol 60000 IU",
    mrp: 140.0,
    is_jan_aushadhi: false,
  },
  {
    brand_name: "Jan Aushadhi Cholecalciferol 60000 IU",
    manufacturer: "PMBI",
    pack_size: "4 capsules",
    composition_display: "Cholecalciferol 60000 IU",
    mrp: 30.0,
    is_jan_aushadhi: true,
  },

  // --------------------------------------------------------------------------
  // Group 31: Narrow Therapeutic Index (NTI) Drugs (Strictly Do-Not-Substitute)
  // --------------------------------------------------------------------------
  {
    brand_name: "Eltroxin 50mcg",
    manufacturer: "GlaxoSmithKline",
    pack_size: "120 tablets",
    composition_display: "Levothyroxine Sodium 50mcg",
    mrp: 175.0,
    is_jan_aushadhi: false,
  },
  {
    brand_name: "Thyronorm 50mcg",
    manufacturer: "Abbott",
    pack_size: "120 tablets",
    composition_display: "Levothyroxine Sodium 50mcg",
    mrp: 185.0,
    is_jan_aushadhi: false,
  },
  {
    brand_name: "Thyronorm 25mcg",
    manufacturer: "Abbott",
    pack_size: "120 tablets",
    composition_display: "Levothyroxine Sodium 25mcg",
    mrp: 150.0,
    is_jan_aushadhi: false,
  },
  {
    brand_name: "Eptoin 100mg",
    manufacturer: "Abbott",
    pack_size: "120 tablets",
    composition_display: "Phenytoin Sodium 100mg",
    mrp: 230.0,
    is_jan_aushadhi: false,
  },
  {
    brand_name: "Tegretol 200mg",
    manufacturer: "Novartis India",
    pack_size: "10 tablets",
    composition_display: "Carbamazepine 200mg",
    mrp: 28.0,
    is_jan_aushadhi: false,
  },
  {
    brand_name: "Mazetol 200mg",
    manufacturer: "Sun Pharma",
    pack_size: "10 tablets",
    composition_display: "Carbamazepine 200mg",
    mrp: 26.5,
    is_jan_aushadhi: false,
  },
  {
    brand_name: "Warf 5mg",
    manufacturer: "Cipla",
    pack_size: "10 tablets",
    composition_display: "Warfarin 5mg",
    mrp: 85.0,
    is_jan_aushadhi: false,
  },
  {
    brand_name: "Lanoxin 0.25mg",
    manufacturer: "GlaxoSmithKline",
    pack_size: "10 tablets",
    composition_display: "Digoxin 0.25mg",
    mrp: 18.0,
    is_jan_aushadhi: false,
  },
  {
    brand_name: "Valparin Chrono 500mg",
    manufacturer: "Sanofi India",
    pack_size: "15 tablets",
    composition_display: "Sodium Valproate 333mg + Valproic Acid 145mg",
    mrp: 185.0,
    is_jan_aushadhi: false,
  },
  {
    brand_name: "Lithosun SR 400mg",
    manufacturer: "Sun Pharma",
    pack_size: "10 tablets",
    composition_display: "Lithium 400mg",
    mrp: 85.0,
    is_jan_aushadhi: false,
  },
  {
    brand_name: "Pangraf 1mg",
    manufacturer: "Panacea Biotec",
    pack_size: "10 capsules",
    composition_display: "Tacrolimus 1mg",
    mrp: 750.0,
    is_jan_aushadhi: false,
  },
];

// ============================================================================
// 4. Optional CSV Parser (built using Node.js built-in fs)
// ============================================================================
function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

function loadCsvMedicines(filePath: string): RawMedicineInput[] {
  if (!fs.existsSync(filePath)) {
    console.warn(`⚠️ Warning: Provided CSV file does not exist: ${filePath}. Skipping CSV import.`);
    return [];
  }

  const raw = fs.readFileSync(filePath, "utf-8");
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length <= 1) {
    console.warn(`⚠️ Warning: CSV file is empty or only contains header: ${filePath}`);
    return [];
  }

  const header = parseCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const brandIdx = header.indexOf("brand_name");
  const compIdx = header.indexOf("composition_display");
  const mrpIdx = header.indexOf("mrp");
  const mfgIdx = header.indexOf("manufacturer");
  const packIdx = header.indexOf("pack_size");
  const jaIdx = header.indexOf("is_jan_aushadhi");

  if (brandIdx === -1 || compIdx === -1 || mrpIdx === -1) {
    console.warn(
      `⚠️ Warning: CSV at ${filePath} is missing required headers (brand_name, composition_display, mrp). Skipping CSV merge.`
    );
    return [];
  }

  const results: RawMedicineInput[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    if (cols.length < 3) continue;

    const brand_name = cols[brandIdx]?.trim();
    const composition_display = cols[compIdx]?.trim();
    const mrp = parseFloat(cols[mrpIdx]?.trim() || "0");

    if (!brand_name || !composition_display || isNaN(mrp) || mrp <= 0) {
      continue;
    }

    const manufacturer = mfgIdx !== -1 && cols[mfgIdx] ? cols[mfgIdx].trim() : null;
    const pack_size = packIdx !== -1 && cols[packIdx] ? cols[packIdx].trim() : null;
    const is_jan_aushadhi =
      jaIdx !== -1
        ? cols[jaIdx]?.trim().toLowerCase() === "true" || cols[jaIdx]?.trim() === "1"
        : false;

    results.push({
      brand_name,
      manufacturer,
      pack_size,
      composition_display,
      mrp,
      is_jan_aushadhi,
      manually_verified: true,
    });
  }

  console.log(`📄 Loaded ${results.length} valid medicine entries from ${filePath}`);
  return results;
}

// ============================================================================
// 5. Existing DB Records Fetcher (Pagination-Safe for Idempotency)
// ============================================================================
async function fetchExistingMedicineKeys(): Promise<Map<string, string>> {
  const map = new Map<string, string>(); // key: `${brand_name.toLowerCase()}|${composition_key}` -> id
  const pageSize = 1000;
  let from = 0;
  let hasMore = true;

  while (hasMore) {
    const { data, error } = await supabase
      .from("medicines")
      .select("id, brand_name, composition_key")
      .range(from, from + pageSize - 1);

    if (error) {
      throw new Error(`Failed to query existing medicines from Supabase: ${error.message}`);
    }

    if (!data || data.length === 0) {
      hasMore = false;
      break;
    }

    for (const row of data) {
      const dedupeKey = `${row.brand_name.trim().toLowerCase()}|${row.composition_key.trim().toLowerCase()}`;
      map.set(dedupeKey, row.id);
    }

    if (data.length < pageSize) {
      hasMore = false;
    } else {
      from += pageSize;
    }
  }

  return map;
}

// ============================================================================
// 6. Main Seeding Routine
// ============================================================================
async function main() {
  console.log("🌱 RxBridge — Curated Medicine Catalog Seeder");
  console.log("==================================================");

  // Parse optional CLI --csv <path>
  const csvFlagIndex = process.argv.indexOf("--csv");
  let allRawItems = [...CURATED_MEDICINES];

  if (csvFlagIndex !== -1 && process.argv[csvFlagIndex + 1]) {
    const csvPath = process.argv[csvFlagIndex + 1];
    const csvItems = loadCsvMedicines(csvPath);
    allRawItems = [...allRawItems, ...csvItems];
  }

  console.log(`📦 Total raw input items: ${allRawItems.length}`);

  // Fetch existing rows to guarantee 100% idempotency
  console.log("🔍 Checking existing medicines in database...");
  const existingMap = await fetchExistingMedicineKeys();
  console.log(`📊 Found ${existingMap.size} existing medicine records in Supabase.`);

  const toInsert: MedicineInsert[] = [];
  let updatedCount = 0;
  let skippedCount = 0;
  const seenInRun = new Set<string>();

  for (const item of allRawItems) {
    const composition_key = buildCompositionKey(item.composition_display);
    const is_nti = isNtiComposition(item.composition_display);
    const is_schedule_h = isScheduleHComposition(item.composition_display);
    const manually_verified = item.manually_verified ?? true;

    const dedupeKey = `${item.brand_name.trim().toLowerCase()}|${composition_key.trim().toLowerCase()}`;

    // De-duplicate if input data has duplicate entries
    if (seenInRun.has(dedupeKey)) {
      skippedCount++;
      continue;
    }
    seenInRun.add(dedupeKey);

    if (existingMap.has(dedupeKey)) {
      const existingId = existingMap.get(dedupeKey)!;
      // Update existing record to ensure clinical flags, composition_key, and pricing are synchronized
      const { error: updateError } = await supabase
        .from("medicines")
        .update({
          manufacturer: item.manufacturer ?? null,
          pack_size: item.pack_size ?? null,
          composition_display: item.composition_display,
          composition_key,
          mrp: item.mrp,
          is_jan_aushadhi: item.is_jan_aushadhi ?? false,
          is_nti,
          is_schedule_h,
          manually_verified,
        })
        .eq("id", existingId);

      if (updateError) {
        console.error(`⚠️ Failed to update ${item.brand_name}: ${updateError.message}`);
      } else {
        updatedCount++;
      }
    } else {
      toInsert.push({
        brand_name: item.brand_name,
        manufacturer: item.manufacturer ?? null,
        pack_size: item.pack_size ?? null,
        composition_display: item.composition_display,
        composition_key,
        mrp: item.mrp,
        is_jan_aushadhi: item.is_jan_aushadhi ?? false,
        is_nti,
        is_schedule_h,
        manually_verified,
      });
    }
  }

  // Batch insert new records in chunks of 50
  let insertedCount = 0;
  const chunkSize = 50;
  for (let i = 0; i < toInsert.length; i += chunkSize) {
    const chunk = toInsert.slice(i, i + chunkSize);
    const { error: insertError } = await supabase.from("medicines").insert(chunk);

    if (insertError) {
      throw new Error(`Failed to insert medicine chunk [${i}..${i + chunk.length}]: ${insertError.message}`);
    }
    insertedCount += chunk.length;
  }

  // Fetch final catalog summary from DB
  const { data: allMedicines, error: summaryError } = await supabase
    .from("medicines")
    .select("composition_key, is_nti, is_jan_aushadhi");

  if (summaryError || !allMedicines) {
    console.warn("⚠️ Could not generate final database summary.");
  } else {
    const totalInDb = allMedicines.length;
    const ntiCount = allMedicines.filter((m) => m.is_nti).length;
    const janAushadhiCount = allMedicines.filter((m) => m.is_jan_aushadhi).length;
    const distinctCompositionKeys = new Set(allMedicines.map((m) => m.composition_key)).size;

    console.log("\n==================================================");
    console.log("✅ Seed Execution Summary:");
    console.log("==================================================");
    console.log(`- Total input records processed : ${allRawItems.length}`);
    console.log(`- New records inserted          : ${insertedCount}`);
    console.log(`- Existing records updated      : ${updatedCount}`);
    console.log(`- Duplicates skipped in batch   : ${skippedCount}`);
    console.log(`- Total medicines in database   : ${totalInDb}`);
    console.log(`- Total NTI drugs (Do-Not-Sub)  : ${ntiCount}`);
    console.log(`- Total Jan Aushadhi generics   : ${janAushadhiCount}`);
    console.log(`- Distinct composition keys     : ${distinctCompositionKeys}`);
    console.log("==================================================");
  }
}

// Execute
main().catch((err) => {
  console.error("❌ Unhandled Error in seed script:", err);
  process.exit(1);
});
