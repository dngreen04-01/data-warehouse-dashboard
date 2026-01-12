
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.87.1";
import { GoogleGenerativeAI } from "https://esm.sh/@google/generative-ai@0.1.3";

const GEMINI_API_KEY = Deno.env.get('GOOGLE_API_KEY') || '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

serve(async (req) => {
    try {
        const formData = await req.formData();
        const emailText = formData.get('text')?.toString() || '';
        const emailFrom = formData.get('from')?.toString() || '';

        console.log(`Received email from: ${emailFrom}`);

        if (!emailText) return new Response("No text content found", { status: 200 });

        // Context Fetching (Resilient)
        let customerContext = '';
        let customers = [];
        try {
            const { data, error } = await supabase
                .schema('dw')
                .from('dim_customer')
                .select('customer_id, customer_name')
                .eq('archived', false)
                .limit(500);
            if (!error && data) {
                customers = data;
                customerContext = customers.map(c => c.customer_name).join('\n');
            }
        } catch (e) {
            console.warn('Skipping context:', e);
        }

        // Call Gemini
        const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });

        const prompt = `
        You are a CRM Data Assistant. Parse this email reply to extract structured customer interactions.
        
        **Email Text:**
        ${emailText}
        
        **Valid Customers:**
        ${customerContext || "No context available - extract names exactly as they appear."}
        
        **Instructions:**
        1. Match mentioned names to the Valid Customers list if possible.
        2. Extract items: Customer, Sentiment, Notes, Activities.
        
        **Output Format:** JSON ONLY.
        {
            "summary": "...",
            "sentiment_score": 0.5,
            "items": [
                {
                    "customer_name": "Name used in email",
                    "matched_name": "Exact DB Name or null",
                    "activity_type": "Insight",
                    "notes": "...",
                    "sentiment": "Positive/Negative/Neutral",
                    "product_mention": "...",
                    "action_required": boolean
                }
            ]
        }
        `;

        const result = await model.generateContent(prompt);
        const responseText = result.response.text();
        const jsonStr = responseText.replace(/```json\n|\n```/g, "").trim();
        const parsedData = JSON.parse(jsonStr);

        // Save Interaction
        const { data: interaction, error: intError } = await supabase
            .schema('crm')
            .from('interactions')
            .insert({
                author_email: emailFrom,
                original_text: emailText,
                summary: parsedData.summary,
                sentiment_score: parsedData.sentiment_score,
                source: 'inbound_email'
            })
            .select()
            .single();

        if (intError) throw intError;

        // Save Items
        const itemsToInsert = parsedData.items.map((item: any) => {
            const dbCustomer = customers.find(c => c.customer_name === item.matched_name);
            return {
                interaction_id: interaction.interaction_id,
                customer_id: dbCustomer?.customer_id || null,
                customer_name_raw: item.customer_name,
                product_mention: item.product_mention,
                activity_type: item.activity_type || 'Insight',
                notes: item.notes,
                sentiment: item.sentiment || 'Neutral',
                action_required: item.action_required || false
            };
        });

        if (itemsToInsert.length > 0) {
            const { error: itemsError } = await supabase
                .schema('crm')
                .from('interaction_items')
                .insert(itemsToInsert);
            if (itemsError) throw itemsError;
        }

        return new Response(JSON.stringify({ success: true }), {
            headers: { "Content-Type": "application/json" },
        });

    } catch (error: any) {
        console.error('Error:', error);
        return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
        });
    }
});
