-- 03_seed_demo.sql  (run on the PRIVATE demo copy only)
-- Turns 8 existing users into the demo personas and shapes a few deals.
-- Names are replaced in this copy only.

update public.users set "First_Name"='Asha',   "Last_Name"='Verma',   "Role"='System_Admin', "Status"='Active', "Region"=null
 where "User_ID"='seed-u-1';
update public.users set "First_Name"='Meera',  "Last_Name"='Kapoor',  "Role"='Sales_Admin',  "Status"='Active', "Region"='East'
 where "User_ID"='seed-u-2';
update public.users set "First_Name"='Dev',    "Last_Name"='Malhotra',"Role"='Sales_Admin',  "Status"='Active', "Region"=null
 where "User_ID"='u-1786635589299-566';
update public.users set "First_Name"='Priya',  "Last_Name"='Nair',    "Role"='Sales_Rep',    "Status"='Active', "Region"='Indore'
 where "User_ID"='seed-u-5';
update public.users set "First_Name"='Rahul',  "Last_Name"='Sharma',  "Role"='Sales_Rep',    "Status"='Active', "Region"='Indore'
 where "User_ID"='seed-u-12';
update public.users set "First_Name"='Neha',   "Last_Name"='Joshi',   "Role"='Sales_Rep',    "Status"='Active', "Region"='Indore, Australia'
 where "User_ID"='seed-u-30';
update public.users set "First_Name"='Kenji',  "Last_Name"='Tanaka',  "Role"='Sales_Rep',    "Status"='Active', "Region"='Japan'
 where "User_ID"='seed-u-15';
update public.users set "First_Name"='Imran',  "Last_Name"='Khan',    "Role"='Sales_Rep',    "Status"='Active', "Region"='East'
 where "User_ID"='seed-u-6';

-- Priya and Rahul: all their deals are Indore deals
update public.deals set "Region"='Indore' where "Owner_ID" in ('seed-u-5', 'seed-u-12');
-- Kenji: all Japan
update public.deals set "Region"='Japan' where "Owner_ID" = 'seed-u-15';
-- Neha (two regions): first deal Indore, second Australia, rest unchanged
update public.deals d
   set "Region" = case x.rn when 1 then 'Indore' when 2 then 'Australia' else d."Region" end
  from (select "Deal_ID", row_number() over (order by "Deal_ID") rn
          from public.deals where "Owner_ID" = 'seed-u-30') x
 where d."Deal_ID" = x."Deal_ID";

-- Valid deal-team case: Rahul (Indore) is added to Priya's first Indore deal
insert into public.deal_team_members ("Deal_ID", "User_ID", "Organization_ID")
select d."Deal_ID", 'seed-u-12', d."Organization_ID"
  from public.deals d
 where d."Owner_ID" = 'seed-u-5'
 order by d."Deal_ID" limit 1
on conflict do nothing;
